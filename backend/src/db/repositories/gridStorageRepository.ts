import type { Database } from "better-sqlite3";

export interface GridStorageRow {
  poolKwh: number;
  initialStockKwh: number;
  operatorExportedKwh: number;
}

/** The operator's grid pool in the community battery (single row). */
export class GridStorageRepository {
  constructor(private readonly db: Database) {}

  /** Creates the row once, pre-charged with `initialPoolKwh` of grey energy. */
  ensure(initialPoolKwh: number): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO grid_storage (id, poolKwh, initialStockKwh, operatorExportedKwh) VALUES ('grid', ?, ?, 0)`)
      .run(initialPoolKwh, initialPoolKwh);
  }

  get(): GridStorageRow {
    const row = this.db.prepare(`SELECT poolKwh, initialStockKwh, operatorExportedKwh FROM grid_storage WHERE id = 'grid'`).get() as
      | GridStorageRow
      | undefined;
    return row ?? { poolKwh: 0, initialStockKwh: 0, operatorExportedKwh: 0 };
  }

  adjustPool(deltaKwh: number): void {
    this.db.prepare(`UPDATE grid_storage SET poolKwh = MAX(0, ROUND(poolKwh + ?, 9)) WHERE id = 'grid'`).run(deltaKwh);
  }

  addOperatorExport(kwh: number): void {
    this.db.prepare(`UPDATE grid_storage SET operatorExportedKwh = operatorExportedKwh + ? WHERE id = 'grid'`).run(kwh);
  }

  addInitialStock(kwh: number): void {
    this.db.prepare(`UPDATE grid_storage SET initialStockKwh = initialStockKwh + ? WHERE id = 'grid'`).run(kwh);
  }
}
