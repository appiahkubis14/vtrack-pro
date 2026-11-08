import { FleetGraph } from './fleet-graph.engine';

describe('FleetGraph', () => {
  function buildSampleGraph(): FleetGraph {
    const graph = new FleetGraph();
    graph.addNode({ id: 'org-1', label: 'Organization', properties: { name: 'Demo Fleet Co' } });
    graph.addNode({ id: 'veh-1', label: 'Vehicle', properties: { plate: 'DEMO-001' } });
    graph.addNode({ id: 'veh-2', label: 'Vehicle', properties: { plate: 'DEMO-002' } });
    graph.addNode({ id: 'dev-1', label: 'Device', properties: { imei: '123' } });
    graph.addNode({ id: 'dev-2', label: 'Device', properties: { imei: '456' } });
    graph.addNode({ id: 'trailer-1', label: 'Trailer', properties: {} });
    graph.addNode({ id: 'asset-1', label: 'Asset', properties: { type: 'refrigerated cargo' } });

    graph.addEdge({ from: 'org-1', to: 'veh-1', type: 'OWNS' });
    graph.addEdge({ from: 'org-1', to: 'veh-2', type: 'OWNS' });
    graph.addEdge({ from: 'dev-1', to: 'veh-1', type: 'HAS_DEVICE' });
    graph.addEdge({ from: 'dev-2', to: 'veh-1', type: 'HAS_DEVICE' });
    graph.addEdge({ from: 'veh-1', to: 'trailer-1', type: 'PULLS' });
    graph.addEdge({ from: 'trailer-1', to: 'asset-1', type: 'CONTAINS' });

    return graph;
  }

  it('finds all vehicles owned by an organization', () => {
    const graph = buildSampleGraph();
    const vehicles = graph.vehiclesForOrganization('org-1');
    expect(vehicles.map((v) => v.id).sort()).toEqual(['veh-1', 'veh-2']);
  });

  it('finds all devices attached to a vehicle via the reverse HAS_DEVICE edge', () => {
    const graph = buildSampleGraph();
    const devices = graph.devicesForVehicle('veh-1');
    expect(devices.map((d) => d.id).sort()).toEqual(['dev-1', 'dev-2']);
  });

  it('returns no devices for a vehicle with none attached', () => {
    const graph = buildSampleGraph();
    expect(graph.devicesForVehicle('veh-2')).toEqual([]);
  });

  it('walks the full vehicle -> trailer -> asset chain', () => {
    const graph = buildSampleGraph();
    const chain = graph.assetChain('veh-1');
    expect(chain.vehicle?.id).toBe('veh-1');
    expect(chain.trailer?.id).toBe('trailer-1');
    expect(chain.assets.map((a) => a.id)).toEqual(['asset-1']);
  });

  it('returns an empty asset chain for a vehicle with no trailer', () => {
    const graph = buildSampleGraph();
    const chain = graph.assetChain('veh-2');
    expect(chain.trailer).toBeUndefined();
    expect(chain.assets).toEqual([]);
  });

  it('throws when adding an edge referencing a node that does not exist', () => {
    const graph = new FleetGraph();
    graph.addNode({ id: 'a', label: 'Vehicle', properties: {} });
    expect(() => graph.addEdge({ from: 'a', to: 'missing', type: 'OWNS' })).toThrow();
  });

  it('traverse() reaches every connected node within maxDepth, in either edge direction', () => {
    const graph = buildSampleGraph();
    const reached = graph.traverse('asset-1', 5).map((n) => n.id).sort();
    // asset-1 <- trailer-1 <- veh-1 <- org-1 -> veh-2, and veh-1 <- dev-1/dev-2
    expect(reached).toEqual(['asset-1', 'dev-1', 'dev-2', 'org-1', 'trailer-1', 'veh-1', 'veh-2']);
  });

  it('traverse() respects maxDepth and does not over-reach', () => {
    const graph = buildSampleGraph();
    const reached = graph.traverse('asset-1', 1).map((n) => n.id).sort();
    expect(reached).toEqual(['asset-1', 'trailer-1']);
  });
});
