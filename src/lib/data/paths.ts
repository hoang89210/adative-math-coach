import path from "path";

export const DATA_DIR = path.resolve(process.cwd(), "..", "data");
export const NODES_PATH = path.join(DATA_DIR, "nodes.jsonl");
export const RELATIONSHIPS_PATH = path.join(DATA_DIR, "relationships.jsonl");
