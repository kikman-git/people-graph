// Fact categories and relationship types are fixed vocabularies enforced by
// the write paths (people_write.py for the bot; lib/db.ts for the web).
export const CATEGORIES = [
  "hobby", "work", "skill", "background", "family",
  "likes", "dislikes", "plans", "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  hobby: "Hobbies", work: "Work", skill: "Skills", background: "Background",
  family: "Family", likes: "Likes", dislikes: "Dislikes", plans: "Plans",
  other: "Other",
};

export const REL_TYPES = [
  "family", "partner", "friend", "colleague", "introduced_by", "other",
] as const;
export type RelType = (typeof REL_TYPES)[number];

export type DirectoryEntry = {
  id: number;
  display_name: string;
  location: string | null;
  aliases: string[];
  tags: string[];               // up to 3, most-used first
  factCount: number;
  lastInteraction: string | null;
  hasPhoto: boolean;
  updated_at: string;
};

// A directory entry that matched a search, with the text that matched it.
export type SearchResult = DirectoryEntry & { match: string | null };

export type PersonCard = {
  id: number;
  display_name: string;
  aliases: string[];
  birthday: string | null;      // YYYY-MM-DD, or MM-DD when the year is unknown
  location: string | null;
  lat: number | null;
  lng: number | null;
  how_we_met: string | null;
  phone: string | null;
  email: string | null;
  handles: Record<string, string> | null;
  hasPhoto: boolean;
  created_at: string;
  updated_at: string;
};

export type Fact = {
  id: number;
  category: Category;
  value: string;
  tag: string | null;
  learned_at: string;
};

export type SupersededFact = Fact & { replacedByValue: string | null };

export type HistoryEntry = {
  id: number;
  happened_on: string;
  place: string | null;
  summary: string;
  with: { id: number; display_name: string }[];
};

export type Relationship = {
  id: number;
  rel_type: RelType;
  label: string | null;
  // Row reads "A —label→ B"; direction says which side this person is.
  // introduced_by is the directed type: A introduced_by B = "B introduced me to A".
  direction: "a" | "b";
  other: { id: number; display_name: string };
};

export type Profile = {
  person: PersonCard;
  about: Partial<Record<Category, Fact[]>>;
  superseded: SupersededFact[];
  history: HistoryEntry[];
  relationships: Relationship[];
};

export type MapPin = {
  id: number;
  display_name: string;
  lat: number;
  lng: number;
  location: string | null;
  hasPhoto: boolean;
  aliases: string[];
  tags: string[];
  facts: string[];              // up to 3 recent active fact values (pin mini-card)
};

/* Validated web-CRUD field sets (lib/db.ts validate* functions produce these) */

export type PersonFields = {
  display_name: string;
  birthday: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  how_we_met: string | null;
  phone: string | null;
  email: string | null;
  handles: string | null;       // JSON string, already validated
  aliases: string[];
};

export type FactFields = {
  category: Category;
  value: string;
  tag: string | null;
  learned_at: string;
};

export type InteractionFields = {
  happened_on: string;
  place: string | null;
  summary: string;
};

export type RelationshipFields = {
  person_a: number;
  person_b: number;
  rel_type: RelType;
  label: string | null;
};

export type TagInfo = { tag: string; facts: number; people: number };
