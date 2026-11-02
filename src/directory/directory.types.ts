/** Read models returned by DirectoryReader. camelCase, decoupled from the table rows. */
export interface OpeningPeriod {
  dayOfWeek: number; // ISO: Monday = 1 ... Sunday = 7
  opensLocal: string; // 'HH:MM:SS' local wall time
  closesLocal: string;
}

export interface Dealership {
  id: string;
  timezone: string; // IANA zone, e.g. Europe/London
  bufferMinutes: number;
  hours: OpeningPeriod[];
}

export interface ServiceType {
  id: string;
  durationMinutes: number;
  requiredSkillCode: string;
}

export interface Vehicle {
  id: string;
  customerId: string;
}

export interface Technician {
  id: string;
  dealershipId: string;
  active: boolean;
}

/** GET /dealerships list entry. */
export interface DealershipSummary {
  id: string;
  name: string;
  timezone: string;
}

/** GET /dealerships/:id: the dealership with everything a client needs to build a booking request. */
export interface DealershipDetail extends DealershipSummary {
  bufferMinutes: number;
  openingHours: { dayOfWeek: number; opensLocal: string; closesLocal: string }[];
  serviceBays: { id: string; name: string; active: boolean }[];
  technicians: {
    id: string;
    name: string;
    active: boolean;
    skills: { code: string; name: string }[];
  }[];
  serviceTypes: {
    id: string;
    code: string;
    name: string;
    durationMinutes: number;
    requiredSkillCode: string;
  }[];
}
