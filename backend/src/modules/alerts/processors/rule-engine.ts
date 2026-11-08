/**
 * Extension point for user-defined alert rules (AlertsController POST/GET /alerts/rules).
 *
 * Not wired to a table yet - AlertsService.createRule()/listRules() currently
 * stub this out. To finish it:
 *
 *   1. Add an `alert_rules` table (organization_id, name, conditions jsonb,
 *      severity, channels jsonb, is_active) via a new migration.
 *   2. Load active rules once at boot + on create/update (cache in memory or
 *      Redis, keyed by organization).
 *   3. Subscribe this class to the same 'position.created' / 'geofence.event'
 *      / 'fuel.event' events that AlertProcessor listens to, and evaluate
 *      each rule's `conditions` (e.g. { field: 'speed', op: 'gt', value: 100 })
 *      against the event payload.
 *   4. Call AlertsService.raise() for any rule whose conditions match.
 *
 * Kept separate from AlertProcessor (the built-in checks) so built-in safety
 * alerts keep working even before this is implemented.
 */
export interface AlertRuleCondition {
  field: string;
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
  value: number | string | boolean;
}

export interface AlertRule {
  id: string;
  organizationId: string;
  name: string;
  conditions: AlertRuleCondition[];
  severity: string;
  isActive: boolean;
}

export function evaluateConditions(conditions: AlertRuleCondition[], payload: Record<string, unknown>): boolean {
  return conditions.every((cond) => {
    const actual = payload[cond.field];
    switch (cond.op) {
      case 'gt':
        return (actual as number) > (cond.value as number);
      case 'gte':
        return (actual as number) >= (cond.value as number);
      case 'lt':
        return (actual as number) < (cond.value as number);
      case 'lte':
        return (actual as number) <= (cond.value as number);
      case 'eq':
        return actual === cond.value;
      case 'neq':
        return actual !== cond.value;
      default:
        return false;
    }
  });
}
