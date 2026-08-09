/*
 * Shared TDG volume rules.
 *
 * Business reset:
 * - Trucks 82112 and 82303 start at 0 kg on 2026-08-10.
 * - Records before that date never contribute Reload volume.
 * - From the reset date onward, only records explicitly saved with
 *   eventType = "reload" are treated as Reload events. Account 003 and
 *   free-text notes alone are intentionally not enough.
 */
(() => {
  const RESET_DATE = "2026-08-10";
  const RESET_VEHICLES = Object.freeze(["82112", "82303"]);
  const MAX_RAW_DEPTH = 8;

  const safe = (value) => String(value ?? "").trim();

  function normalizeVehicleNo(value) {
    return safe(value).toUpperCase().replace(/[^0-9A-Z]/g, "");
  }

  function isResetVehicle(value) {
    return RESET_VEHICLES.includes(normalizeVehicleNo(value));
  }

  function getRecordLayers(record) {
    const layers = [];
    const seen = new Set();
    let current = record;

    while (
      current &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      !seen.has(current) &&
      layers.length < MAX_RAW_DEPTH
    ) {
      layers.push(current);
      seen.add(current);
      current = current.raw;
    }

    return layers;
  }

  function firstDefined(record, keys) {
    for (const layer of getRecordLayers(record)) {
      for (const key of keys) {
        if (layer[key] !== undefined && layer[key] !== null) {
          return layer[key];
        }
      }
    }
    return undefined;
  }

  function getWorkDate(record) {
    return safe(firstDefined(record, ["work_date", "date", "workDate"]));
  }

  function getVehicleNo(record) {
    return normalizeVehicleNo(
      firstDefined(record, ["vehicle_no", "vehicleNo"]),
    );
  }

  function getEventType(record) {
    return safe(firstDefined(record, ["eventType", "event_type"]))
      .toLowerCase();
  }

  function isOnOrAfterReset(record) {
    const workDate = getWorkDate(record);
    return /^\d{4}-\d{2}-\d{2}$/.test(workDate) && workDate >= RESET_DATE;
  }

  function isReloadRecord(record) {
    return isOnOrAfterReset(record) && getEventType(record) === "reload";
  }

  function getReloadAmountKg(record) {
    if (!isReloadRecord(record)) return 0;

    const amount = Number(
      firstDefined(record, ["reloadAmountKg", "reload_amount_kg"]),
    );

    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  function getTdgStartKg(record) {
    const value = Number(
      firstDefined(record, [
        "tdg_volume",
        "tdgVolume",
        "tdgStartVolume",
      ]),
    );

    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function flattenRawRecord(record) {
    const flattened = {};
    const layers = getRecordLayers(record).slice().reverse();

    for (const layer of layers) {
      for (const [key, value] of Object.entries(layer)) {
        if (
          key === "raw" ||
          key === "synced" ||
          key === "syncError" ||
          key === "remoteId"
        ) {
          continue;
        }

        flattened[key] = value;
      }
    }

    if (getEventType(record)) {
      flattened.eventType = getEventType(record);
    }

    const reloadAmountKg = getReloadAmountKg(record);
    if (reloadAmountKg > 0) {
      flattened.reloadAmountKg = reloadAmountKg;
    }

    return flattened;
  }

  window.TDG_VOLUME = Object.freeze({
    RESET_DATE,
    RESET_VEHICLES,
    normalizeVehicleNo,
    isResetVehicle,
    getRecordLayers,
    getWorkDate,
    getVehicleNo,
    getEventType,
    isReloadRecord,
    getReloadAmountKg,
    getTdgStartKg,
    flattenRawRecord,
  });
})();
