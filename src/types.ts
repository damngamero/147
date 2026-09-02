export type ID = string;

/** yyyy-mm-dd, always local time */
export type ISODate = string;

export interface Subject {
  id: ID;
  name: string;
  color: string;
  /**
   * Practise daily instead of blurting. Maths does not survive a four-day gap
   * the way recall subjects do, so a subject with this on schedules NO class
   * or chapter blurts at all — its topics come up in the daily drill instead.
   */
  drill?: boolean;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
}

/**
 * How a chapter's classes get revised. 'blurt' = write everything you remember
 * from scratch; 'questions' = work practice questions on paper. Maths and some
 * physics chapters want questions, not recall.
 */
export type RevisionMethod = 'blurt' | 'questions';

export interface Chapter {
  id: ID;
  subjectId: ID;
  name: string;
  order: number;
  method: RevisionMethod;
  /** user has marked the chapter as fully taught */
  finished: boolean;
  finishedAt: number | null;
  /** set once the chapter graduates to the fortnightly cycle */
  fortnightlyFrom: ISODate | null;
  createdAt: number;
  updatedAt: number;
}

export interface Topic {
  id: ID;
  chapterId: ID;
  subjectId: ID;
  name: string;
  /** flagged by the user as the final topic of its chapter */
  isLast: boolean;
  /** date of the class this topic was first taught in */
  taughtOn: ISODate | null;
  createdAt: number;
  updatedAt: number;
}

/** One class that happened, plus what was actually done in it. */
export interface ClassLog {
  id: ID;
  date: ISODate;
  subjectId: ID;
  chapterId: ID;
  /** Optional custom name — classes logged before this existed just fall back to their date. */
  name?: string;
  /** free text: what the class covered / what I did */
  what: string;
  topicIds: ID[];
  createdAt: number;
  updatedAt: number;
}

export type BlurtCycle = 'r1' | 'r4' | 'r7' | 'weekly' | 'fortnightly' | 'daily';
export type BlurtStatus = 'due' | 'done' | 'missed' | 'cancelled';

export interface Blurt {
  id: ID;
  /**
   * A blurt covers a whole class at once — every topic taught in it, together —
   * or, once a chapter has graduated, the whole chapter. 'topic' is the odd one
   * out: a single topic in a drill subject, generated fresh each day.
   */
  kind: 'class' | 'chapter' | 'topic';
  /** classLog id when kind==='class', chapterId when 'chapter', topicId when 'topic' */
  refId: ID;
  subjectId: ID;
  chapterId: ID;
  dueDate: ISODate;
  cycle: BlurtCycle;
  /** 1-based position within a repeating cycle (weekly / fortnightly); 0 for the ladder */
  seq: number;
  status: BlurtStatus;
  doneOn: ISODate | null;
  /** average of the per-topic ratings, for display */
  score: number | null;
  /** topicId -> 1-5 self rating. This is what the weak-spot list is built from. */
  scores: Record<ID, number>;
  /** Drills only: how many questions were worked on this topic. */
  questionsDone?: number;
  /** Drills only: attempts it generally took — 1-4, where 4 means 4+, and 0 means never got it. */
  attempts?: number;
  createdAt: number;
  updatedAt: number;
}

/** What I actually got through on a given day. */
export interface DayLog {
  date: ISODate;
  note: string;
  updatedAt: number;
}

/** Records a deletion so it survives a sync instead of being resurrected. */
export interface Tombstone {
  key: string;
  store: string;
  id: string;
  at: number;
}

export interface DB {
  subjects: Subject[];
  chapters: Chapter[];
  topics: Topic[];
  logs: ClassLog[];
  blurts: Blurt[];
  days: DayLog[];
  deletes: Tombstone[];
}
