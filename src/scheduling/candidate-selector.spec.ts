import { CandidateSelector } from './candidate-selector';

describe('CandidateSelector', () => {
  const s = new CandidateSelector();

  it('orders by lowest bay id, then lowest technician id, when no preference', () => {
    expect(s.rank(['b2', 'b1'], ['t2', 't1'], null)).toEqual([
      { bayId: 'b1', technicianId: 't1' },
      { bayId: 'b1', technicianId: 't2' },
      { bayId: 'b2', technicianId: 't1' },
      { bayId: 'b2', technicianId: 't2' },
    ]);
  });

  it('puts the preferred technician first when they are free and qualified', () => {
    expect(s.rank(['b1', 'b2'], ['t1', 't2'], 't2').map((c) => c.technicianId)).toEqual([
      't2',
      't2',
      't1',
      't1',
    ]);
  });

  it('falls back to the stable order when the preferred technician is not in the set', () => {
    expect(s.rank(['b1'], ['t1'], 't9')).toEqual([{ bayId: 'b1', technicianId: 't1' }]);
  });

  it('drops only the resource named by the violated constraint', () => {
    const all = s.rank(['b1', 'b2'], ['t1', 't2'], null);
    const tried = all[0];
    expect(s.dropTaken(all, tried, 'bay').every((c) => c.bayId === 'b2')).toBe(true);
    expect(s.dropTaken(all, tried, 'technician').every((c) => c.technicianId === 't2')).toBe(true);
    expect(s.dropTaken(all, tried, 'vehicle')).toEqual([]);
  });
});
