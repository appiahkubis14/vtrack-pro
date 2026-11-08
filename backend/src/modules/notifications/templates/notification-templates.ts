/**
 * Simple string-substitution templates, keyed by alert type. Swap for
 * Handlebars (.hbs, already referenced in nest-cli.json's `assets`) once you
 * need richer HTML emails.
 */
export const NOTIFICATION_TEMPLATES: Record<string, { subject: string; body: string }> = {
  speeding: {
    subject: 'Speeding alert: {{vehicleName}}',
    body: '{{vehicleName}} was traveling at {{speed}} km/h at {{time}}.',
  },
  geofence_exit: {
    subject: 'Geofence exit: {{vehicleName}}',
    body: '{{vehicleName}} left "{{geofenceName}}" at {{time}}.',
  },
  fuel_theft: {
    subject: 'Possible fuel theft: {{vehicleName}}',
    body: 'Fuel level dropped {{deltaPercent}}% while {{vehicleName}} was stationary at {{time}}.',
  },
  maintenance_due: {
    subject: 'Maintenance due: {{vehicleName}}',
    body: '{{vehicleName}} is due for {{serviceType}} on {{dueDate}}.',
  },
};

export function renderTemplate(templateKey: string, vars: Record<string, string | number>): { subject: string; body: string } {
  const template = NOTIFICATION_TEMPLATES[templateKey];
  if (!template) throw new Error(`No template registered for "${templateKey}"`);

  const fill = (s: string) => s.replace(/{{(\w+)}}/g, (_, key) => String(vars[key] ?? `{{${key}}}`));
  return { subject: fill(template.subject), body: fill(template.body) };
}
