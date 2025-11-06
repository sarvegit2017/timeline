// Code.gs
function doGet() {
  return HtmlService.createTemplateFromFile("index")
    .evaluate()
    .setTitle("Historical Timeline")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Multi-timeline backend for the Historical Timeline web app.
 * - Sheet structure: TimelineName | EventName | Year | Era | NumericYear | Abbreviation | Description
 * - Auto-migrates from old 6-column format (adds TimelineName="Timeline 1")
 * - CRUD with robust matching using composite keys (timeline+name+year+era)
 * - Grouped fetch for rendering multiple timelines at once
 */

const SHEET_NAME = "TimelineData";

const REQUIRED_HEADERS = [
  "TimelineName",
  "EventName",
  "Year",
  "Era",
  "NumericYear",
  "Abbreviation",
  "Description",
];

// Old layout (for auto-migration)
const OLD_HEADERS = [
  "EventName",
  "Year",
  "Era",
  "NumericYear",
  "Abbreviation",
  "Description",
];

/** Ensure sheet exists, headers OK, and migrate if needed. Return the sheet. */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  // If empty sheet, write new headers
  if (lastRow === 0) {
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
    return sheet;
  }

  // Read up to 7 headers (new) or 6 (old)
  const headers = sheet.getRange(1, 1, 1, Math.max(lastCol, REQUIRED_HEADERS.length))
    .getValues()[0]
    .slice(0, REQUIRED_HEADERS.length);

  const normalized = (arr) => arr.map(h => (h || "").toString().trim());

  const h = normalized(headers);

  // Detect old 6-column format and migrate
  const isOld =
    h[0] === OLD_HEADERS[0] &&
    h[1] === OLD_HEADERS[1] &&
    h[2] === OLD_HEADERS[2] &&
    h[3] === OLD_HEADERS[3] &&
    h[4] === OLD_HEADERS[4] &&
    h[5] === OLD_HEADERS[5];

  if (isOld) {
    // Insert new column A and set TimelineName, default "Timeline 1"
    sheet.insertColumnBefore(1);
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
    const dataRows = sheet.getLastRow() - 1;
    if (dataRows > 0) {
      sheet.getRange(2, 1, dataRows, 1).setValue("Timeline 1");
    }
    return sheet;
  }

  // If headers mismatch, rewrite header row to REQUIRED_HEADERS
  const needRewrite =
    REQUIRED_HEADERS.some((val, i) => val !== (h[i] || "") ) ||
    sheet.getLastColumn() < REQUIRED_HEADERS.length;
  if (needRewrite) {
    sheet.getRange(1, 1, 1, REQUIRED_HEADERS.length).setValues([REQUIRED_HEADERS]);
  }

  return sheet;
}

function makeAbbreviation(name) {
  if (!name) return "";
  return name
    .toString()
    .trim()
    .split(/\s+/)
    .map(w => w[0] ? w[0].toUpperCase() : "")
    .join("");
}

function computeNumericYear(year, era) {
  const y = parseInt(year, 10);
  if (isNaN(y)) return 0;
  return (era === "BC" ? -Math.abs(y) : Math.abs(y));
}

/**
 * Return all events grouped by timeline name.
 * Shape:
 * {
 *   timelines: [
 *     { name: "Timeline 1", events: [ {name, year, era, numericYear, abbreviation, description} ] },
 *     { name: "Timeline 2", events: [...] }
 *   ],
 *   timelineNames: ["Timeline 1","Timeline 2",...]
 * }
 */
function getEventsGrouped() {
  const sheet = getSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { timelines: [], timelineNames: [] };

  // Read all rows
  const data = sheet.getRange(2, 1, lastRow - 1, REQUIRED_HEADERS.length).getValues();

  // Group by timeline
  const map = {};
  data.forEach(row => {
    const timelineName = (row[0] || "Untitled").toString();
    const name = row[1] || "";
    const year = row[2] !== "" && row[2] !== null ? row[2] : "";
    const era = row[3] || "";
    const numericYear = row[4] !== "" && row[4] !== null
      ? row[4]
      : computeNumericYear(year, era);
    const abbreviation = row[5] || makeAbbreviation(name);
    const description = row[6] || "";

    const ev = { name, year, era, numericYear, abbreviation, description, timelineName };
    if (!map[timelineName]) map[timelineName] = [];
    map[timelineName].push(ev);
  });

  // Sort each timeline chronologically
  const timelines = Object.keys(map).sort().map(name => {
    const events = map[name].sort((a, b) => (a.numericYear || 0) - (b.numericYear || 0));
    return { name, events };
  });

  return { timelines, timelineNames: timelines.map(t => t.name) };
}

/** Add a new event to a specific timeline. */
function addEvent(eventData) {
  try {
    if (!eventData) return { success: false, message: "No event data." };

    const timelineName = (eventData.timelineName || "Timeline 1").toString();
    const name = (eventData.name || "").toString().trim();
    const yearNum = parseInt(eventData.year, 10);
    const era = (eventData.era || "CE").toString();
    const description = (eventData.description || "").toString();

    if (!name) return { success: false, message: "Missing event name." };
    if (isNaN(yearNum)) return { success: false, message: "Year must be a number." };

    const numericYear = computeNumericYear(yearNum, era);
    const abbreviation = makeAbbreviation(name);

    const sheet = getSheet();
    sheet.appendRow([timelineName, name, yearNum, era, numericYear, abbreviation, description]);

    return { success: true, message: `Event '${name}' added to '${timelineName}'.` };
  } catch (e) {
    return { success: false, message: "Error adding event: " + e.message };
  }
}

/**
 * Update an existing event by composite key (original values).
 * event = {
 *   // original identifiers (required to find the row):
 *   original: { timelineName, name, year, era },
 *   // new values:
 *   timelineName, name, year, era, description
 * }
 */
function updateEvent(event) {
  try {
    if (!event || !event.original) {
      return { success: false, message: "Missing original identifiers." };
    }

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "No events to update." };

    const data = sheet.getRange(2, 1, lastRow - 1, REQUIRED_HEADERS.length).getValues();

    const o = event.original;
    const matchRowIndex = data.findIndex(row =>
      String(row[0]) === String(o.timelineName) &&
      String(row[1]) === String(o.name) &&
      String(row[2]) === String(o.year) &&
      String(row[3]) === String(o.era)
    );

    if (matchRowIndex === -1) {
      return { success: false, message: "Event not found for update." };
    }

    // Prepare new values, falling back to old where missing
    const newTimeline = event.timelineName || data[matchRowIndex][0] || "Timeline 1";
    const newName = (event.name || data[matchRowIndex][1] || "").toString();
    const newYearNum = parseInt(event.year ?? data[matchRowIndex][2], 10);
    if (isNaN(newYearNum)) return { success: false, message: "Year must be a number." };
    const newEra = (event.era || data[matchRowIndex][3] || "CE").toString();
    const newNumeric = computeNumericYear(newYearNum, newEra);
    const newAbbrev = makeAbbreviation(newName);
    const newDesc = (event.description ?? data[matchRowIndex][6] ?? "").toString();

    const targetRow = matchRowIndex + 2;
    sheet.getRange(targetRow, 1, 1, REQUIRED_HEADERS.length).setValues([[
      newTimeline, newName, newYearNum, newEra, newNumeric, newAbbrev, newDesc
    ]]);

    return { success: true, message: "Event updated successfully." };
  } catch (e) {
    return { success: false, message: "Error updating event: " + e.message };
  }
}

/**
 * Delete by composite key.
 * params = { timelineName, name, year, era }
 */
function deleteEvent(params) {
  try {
    if (!params) return { success: false, message: "No delete parameters." };

    const sheet = getSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { success: false, message: "No events to delete." };

    const data = sheet.getRange(2, 1, lastRow - 1, REQUIRED_HEADERS.length).getValues();

    const idx = data.findIndex(row =>
      String(row[0]) === String(params.timelineName) &&
      String(row[1]) === String(params.name) &&
      String(row[2]) === String(params.year) &&
      String(row[3]) === String(params.era)
    );

    if (idx === -1) return { success: false, message: "Event not found." };

    sheet.deleteRow(idx + 2);
    return { success: true, message: "Event deleted." };
  } catch (e) {
    return { success: false, message: "Error deleting event: " + e.message };
  }
}

/** For convenience (dropdowns etc.) */
function getTimelineNames() {
  const grouped = getEventsGrouped();
  return grouped.timelineNames || [];
}
