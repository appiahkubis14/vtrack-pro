import { ImmobilizerSafetyEngine } from './immobilizer-safety.engine';

describe('ImmobilizerSafetyEngine', () => {
  const engine = new ImmobilizerSafetyEngine();

  it('allows immobilization when the vehicle is stationary', () => {
    const result = engine.evaluate(0);
    expect(result.safeToImmobilize).toBe(true);
  });

  it('allows immobilization at low speed (parking-lot maneuvering range)', () => {
    const result = engine.evaluate(10);
    expect(result.safeToImmobilize).toBe(true);
  });

  it('blocks immobilization just above the safety threshold', () => {
    const result = engine.evaluate(11);
    expect(result.safeToImmobilize).toBe(false);
    expect(result.reason).toContain('11km/h');
  });

  it('blocks immobilization at highway speed', () => {
    const result = engine.evaluate(120);
    expect(result.safeToImmobilize).toBe(false);
    expect(result.reason).toMatch(/crash/i);
  });

  it('always returns the input speed unmodified for audit purposes', () => {
    expect(engine.evaluate(47).speedKmh).toBe(47);
  });
});
