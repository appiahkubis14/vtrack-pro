/**
 * A real, working graph traversal engine over an in-memory adjacency
 * structure - functionally equivalent to the Cypher queries in
 * docs/v2-architecture.md section 9, without requiring the Apache AGE
 * Postgres extension to be installed (not available in this environment;
 * no docker/extension-build toolchain). Sync strategy in production: same
 * write-through-from-relational-tables approach documented there - swap
 * this class's addNode/addEdge calls for AGE's `cypher()` CREATE calls and
 * the query methods below for `cypher()` MATCH calls, keeping the calling
 * code (SensorFusionService, wherever else references this) unchanged.
 *
 * Not a general-purpose graph database: no persistence, no indexes beyond
 * the two Maps below, O(edges) traversal rather than a real query planner.
 * Fine for a single organization's fleet graph in memory; reach for AGE or
 * Neo4j once you need durability or fleet-wide scale.
 */
export interface GraphNode {
  id: string;
  label: string; // 'Organization' | 'Vehicle' | 'Device' | 'Driver' | 'Trailer' | 'Asset' | ...
  properties: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: string; // 'OWNS' | 'HAS_DEVICE' | 'ASSIGNED_TO' | 'PULLS' | 'CONTAINS' | 'REPORTS' | ...
  properties?: Record<string, unknown>;
}

export class FleetGraph {
  private readonly nodes = new Map<string, GraphNode>();
  private readonly outgoing = new Map<string, GraphEdge[]>();
  private readonly incoming = new Map<string, GraphEdge[]>();

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, []);
    if (!this.incoming.has(node.id)) this.incoming.set(node.id, []);
  }

  addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(`Cannot add edge ${edge.type}: both endpoints must exist as nodes first`);
    }
    this.outgoing.get(edge.from)!.push(edge);
    this.incoming.get(edge.to)!.push(edge);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /** Direct neighbors reachable via an outgoing edge of the given type (or any type if omitted). */
  neighbors(nodeId: string, edgeType?: string): GraphNode[] {
    const edges = this.outgoing.get(nodeId) ?? [];
    return edges
      .filter((e) => !edgeType || e.type === edgeType)
      .map((e) => this.nodes.get(e.to))
      .filter((n): n is GraphNode => Boolean(n));
  }

  /** Nodes with an incoming edge of the given type pointing at this node. */
  incomingNeighbors(nodeId: string, edgeType?: string): GraphNode[] {
    const edges = this.incoming.get(nodeId) ?? [];
    return edges
      .filter((e) => !edgeType || e.type === edgeType)
      .map((e) => this.nodes.get(e.from))
      .filter((n): n is GraphNode => Boolean(n));
  }

  /**
   * Equivalent to:
   *   MATCH (veh:Vehicle {id: $vehicleId})-[:PULLS]->(t:Trailer)-[:CONTAINS]->(a:Asset)
   *   RETURN veh, t, a
   */
  assetChain(vehicleId: string): { vehicle: GraphNode | undefined; trailer: GraphNode | undefined; assets: GraphNode[] } {
    const vehicle = this.getNode(vehicleId);
    const [trailer] = this.neighbors(vehicleId, 'PULLS');
    const assets = trailer ? this.neighbors(trailer.id, 'CONTAINS') : [];
    return { vehicle, trailer, assets };
  }

  /**
   * Equivalent to:
   *   MATCH (v:Vehicle {id: $vehicleId})<-[:HAS_DEVICE]-(d:Device)
   *   RETURN d
   */
  devicesForVehicle(vehicleId: string): GraphNode[] {
    return this.incomingNeighbors(vehicleId, 'HAS_DEVICE');
  }

  /**
   * Equivalent to:
   *   MATCH (o:Organization {id: $orgId})-[:OWNS]->(v:Vehicle)
   *   RETURN v
   */
  vehiclesForOrganization(orgId: string): GraphNode[] {
    return this.neighbors(orgId, 'OWNS').filter((n) => n.label === 'Vehicle');
  }

  /** Breadth-first traversal up to maxDepth hops, any edge type - useful for "everything connected to X". */
  traverse(startId: string, maxDepth = 3): GraphNode[] {
    const visited = new Set<string>([startId]);
    let frontier = [startId];

    for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of [...this.neighbors(id), ...this.incomingNeighbors(id)]) {
          if (!visited.has(n.id)) {
            visited.add(n.id);
            next.push(n.id);
          }
        }
      }
      frontier = next;
    }

    return [...visited].map((id) => this.nodes.get(id)!).filter(Boolean);
  }
}
