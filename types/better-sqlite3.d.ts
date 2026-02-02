declare module "better-sqlite3" {
  export interface Statement {
    get(...params: any[]): any;
    all(...params: any[]): any[];
    run(...params: any[]): any;
  }

  export default class Database {
    constructor(filename?: string, options?: any);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
  }
}
