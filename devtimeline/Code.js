/** My first change
 * @fileoverview Backend logic for the Historical Timeline web app.
 */



/**
 * Serve index.html
 */
function doGet() {
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("Historical Timeline-1")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Robust backend for the Historical Timeline web app.
 * - Ensures headers
 * - Returns consistent event object properties
 * - Supports add, update (flexible params), and delete
 */

const SHEET_NAME = "TimelineData";

/** Ensure sheet exists and has correct headers; returns sheet. */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const requiredHeaders = ["EventName", "Year", "Era", "NumericYear", "Abbreviation", "Description"];

  // If completely empty, create headers
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(requiredHeaders);
    return sheet;
  }

  // Ensure header row length and values match - if not, set them
  const existingHeaders = sheet.getRange(1, 1, 1, requiredHeaders.length).getValues()[0] || [];
  let needRewrite = false;

  // If any header cell is missing or doesn't match, rewrite entire header row
  if (existingHeaders.length !== requiredHeaders.length) {
    needRewrite = true;
  } else {
    for (let i = 0; i < requiredHeaders.length; i++) {
      if ((existingHeaders[i] || "").toString().trim() !== requiredHeaders[i]) {
        needRewrite = true;
        break;
      }
    }
  }

  if (needRewrite) {
    sheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
  }

  return sheet;
}

/** Convert a name string to an abbreviation label (e.g., "First Temple" -> "FT") */
function makeAbbreviation(name) {
  if (!name) return "";
  return name
    .toString()
    .trim()
    .split(/\s+/)
    .map(w => w[0].toUpperCase())
    .join("");
}

/**
 * Return all events as objects. Each object contains:
 * { name, year, era, numericYear, label, abbreviation, description }
 */
function getEvents() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();

  // No data rows
  if (lastRow < 2) return [];

  // Read 6 columns (A:F) from row 2..lastRow
  const data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

  const events = data.map(row => {
    const name = row[0] || "";
    const year = row[1] !== "" && row[1] !== null ? row[1] : "";
    const era = row[2] || "";
    const numericYear = row[3] !== "" && row[3] !== null ? row[3] : (() => {
      // attempt to compute numericYear if missing
      const y = parseInt(year, 10);
      if (isNaN(y)) return 0;
      return (era === "BC" ? -Math.abs(y) : Math.abs(y));
    })();
    const abbrev = (row[4] || makeAbbreviation(name) || "");
    const description = row[5] || "";

    return {
      name: name,
      year: year,
      era: era,
      numericYear: numericYear,
      label: abbrev,           // older frontends expect `label`
      abbreviation: abbrev,    // some frontends expect `abbreviation`
      description: description
    };
  });

  // Sort chronologically by numericYear (ascending)
  events.sort((a, b) => (a.numericYear || 0) - (b.numericYear || 0));
  return events;
}

/**
 * Add a new event.
 * eventData: { name, year, era, description }
 */
function addEvent(eventData) {
  try {
    if (!eventData || !eventData.name || !eventData.year) {
      return { success: false, message: "Missing name or year." };
    }

    const sheet = getSheet();
    const name = eventData.name.toString();
    const yearNum = parseInt(eventData.year, 10);
    if (isNaN(yearNum)) return { success: false, message: "Year must be a number." };
    const era = eventData.era || "CE";
    const numericYear = era === "BC" ? -Math.abs(yearNum) : Math.abs(yearNum);
    const description = eventData.description || "";
    const abbreviation = makeAbbreviation(name);

    sheet.appendRow([name, yearNum, era, numericYear, abbreviation, description]);
    return { success: true, message: `Event '${name}' added.` };
  } catch (e) {
    return { success: false, message: "Error adding event: " + e.message };
  }
}

/**
 * Update an existing event.
 * Accepts flexible identifying params:
 * - Either eventData.originalName OR eventData.oldName (string)
 * - Optionally eventData.oldYear and eventData.oldEra for more precise matching
 *
 * New values: name, year, era, description
 *
 * Returns { success: boolean, message: string }
 */
function updateEvent(eventData) {
  try {
    if (!eventData) return { success: false, message: "No data provided." };

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "No events to update." };

    const rows = sheet.getRange(2, 1, lastRow - 1, 6).getValues();

    // identify search keys (support both originalName and oldName)
    const nameKey = eventData.originalName || eventData.oldName || "";
    const oldYearKey = (typeof eventData.oldYear !== "undefined") ? eventData.oldYear : null;
    const oldEraKey = (typeof eventData.oldEra !== "undefined") ? eventData.oldEra : null;

    if (!nameKey) return { success: false, message: "No identifying originalName/oldName provided." };

    // New values
    const newName = eventData.name || nameKey;
    const newYear = eventData.year !== undefined && eventData.year !== null ? parseInt(eventData.year, 10) : rows[0][1];
    if (isNaN(newYear)) return { success: false, message: "New year is invalid." };
    const newEra = eventData.era || "CE";
    const newNumericYear = (newEra === "BC") ? -Math.abs(newYear) : Math.abs(newYear);
    const newDescription = eventData.description || "";
    const newAbbrev = makeAbbreviation(newName);

    // Search for the row: prefer exact match on name + (if provided) year + era
    let foundIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const rName = (rows[i][0] || "").toString();
      const rYear = rows[i][1];
      const rEra = (rows[i][2] || "").toString();

      const nameMatches = rName === nameKey;
      const yearMatches = oldYearKey === null ? true : (String(rYear) === String(oldYearKey));
      const eraMatches = oldEraKey === null ? true : (rEra === oldEraKey);

      if (nameMatches && yearMatches && eraMatches) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      // try looser match by name only (case-insensitive)
      for (let i = 0; i < rows.length; i++) {
        if ((rows[i][0] || "").toString().toLowerCase() === nameKey.toString().toLowerCase()) {
          foundIndex = i;
          break;
        }
      }
    }

    if (foundIndex === -1) {
      return { success: false, message: "Event to update not found." };
    }

    // Write new values to the found row (sheet row index = foundIndex + 2)
    const targetRow = foundIndex + 2;
    sheet.getRange(targetRow, 1, 1, 6).setValues([[
      newName,
      newYear,
      newEra,
      newNumericYear,
      newAbbrev,
      newDescription
    ]]);

    return { success: true, message: "Event updated successfully." };

  } catch (e) {
    return { success: false, message: "Error updating event: " + e.message };
  }
}

/**
 * Delete event by name (first match). Returns status object.
 */
function deleteEvent(params) {
  try {
    // params may be a simple string (name) or object { name: "...", year:..., era:... }
    let nameToDelete = "";
    let yearToDelete = null;
    let eraToDelete = null;

    if (typeof params === "string") {
      nameToDelete = params;
    } else if (params && typeof params === "object") {
      nameToDelete = params.name || "";
      yearToDelete = (typeof params.year !== "undefined") ? params.year : null;
      eraToDelete = (typeof params.era !== "undefined") ? params.era : null;
    } else {
      return { success: false, message: "No name provided to delete." };
    }

    if (!nameToDelete) return { success: false, message: "No name provided to delete." };

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "No events available." };

    const rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues(); // read A:C for match
    let foundIndex = -1;
    for (let i = 0; i < rows.length; i++) {
      const rName = (rows[i][0] || "").toString();
      const rYear = rows[i][1];
      const rEra = (rows[i][2] || "").toString();
      const nameMatches = rName === nameToDelete;
      const yearMatches = yearToDelete === null ? true : (String(rYear) === String(yearToDelete));
      const eraMatches = eraToDelete === null ? true : (rEra === eraToDelete);

      if (nameMatches && yearMatches && eraMatches) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      // try case-insensitive name match
      for (let i = 0; i < rows.length; i++) {
        if ((rows[i][0] || "").toString().toLowerCase() === nameToDelete.toString().toLowerCase()) {
          foundIndex = i;
          break;
        }
      }
    }

    if (foundIndex === -1) return { success: false, message: "Event to delete not found." };

    sheet.deleteRow(foundIndex + 2);
    return { success: true, message: "Event deleted." };

  } catch (e) {
    return { success: false, message: "Error deleting event: " + e.message };
  }
}
