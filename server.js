const fs = require("node:fs/promises");
const path = require("node:path");
const express = require("express");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_PATH = path.join(__dirname, "database.json");
const PUBLIC_PATH = path.join(__dirname, "public");
const collections = {
  employees: "EMP",
  attendance: "ATT",
  leaveRequests: "LEV"
};
let database;
let writeQueue = Promise.resolve();

app.use(express.json({ limit: "100kb" }));
app.use("/vendor", express.static(path.join(__dirname, "node_modules", "chart.js", "dist")));
app.use(express.static(PUBLIC_PATH));

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isDate(value) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validateEmployee(record) {
  const required = ["firstName", "lastName", "email", "department", "position"];
  for (const field of required) {
    if (!isNonEmptyString(record[field])) {
      return `${field} must be a non-empty string`;
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
    return "email must be a valid email address";
  }
  if (record.hireDate !== undefined && !isDate(record.hireDate)) {
    return "hireDate must use YYYY-MM-DD format";
  }
  if (record.employmentStatus !== undefined &&
      !["active", "inactive", "on-leave"].includes(record.employmentStatus)) {
    return "employmentStatus must be active, inactive, or on-leave";
  }
  return null;
}

function validateAttendance(record) {
  if (!isNonEmptyString(record.employeeId)) return "employeeId is required";
  if (!isDate(record.date)) return "date must use YYYY-MM-DD format";
  if (!["present", "late", "absent", "leave"].includes(record.status)) {
    return "status must be present, late, absent, or leave";
  }
  for (const field of ["checkIn", "checkOut"]) {
    if (record[field] !== undefined && record[field] !== null &&
        (typeof record[field] !== "string" ||
         !/^([01]\d|2[0-3]):[0-5]\d$/.test(record[field]))) {
      return `${field} must use HH:MM format or be null`;
    }
  }
  return null;
}

function validateLeaveRequest(record) {
  if (!isNonEmptyString(record.employeeId)) return "employeeId is required";
  if (!isNonEmptyString(record.type)) return "type is required";
  if (!isDate(record.startDate)) return "startDate must use YYYY-MM-DD format";
  if (!isDate(record.endDate)) return "endDate must use YYYY-MM-DD format";
  if (record.endDate < record.startDate) {
    return "endDate must be on or after startDate";
  }
  if (!["pending", "approved", "rejected"].includes(record.status)) {
    return "status must be pending, approved, or rejected";
  }
  return null;
}

function saveDatabase() {
  writeQueue = writeQueue.then(async () => {
    const temporaryPath = `${DATABASE_PATH}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(database, null, 2)}\n`);
    await fs.rename(temporaryPath, DATABASE_PATH);
  });
  return writeQueue;
}

function createCrudRoutes(collection, prefix, validate) {
  const router = express.Router();

  router.get("/", (req, res) => {
    res.json(database[collection]);
  });

  router.get("/:id", (req, res) => {
    const record = database[collection].find(item => item.id === req.params.id);
    if (!record) return res.status(404).json({ error: "Record not found" });
    res.json(record);
  });

  router.post("/", async (req, res, next) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });

    const highestId = database[collection].reduce((highest, item) => {
      const match = new RegExp(`^${prefix}(\\d+)$`).exec(item.id);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);
    const record = { ...req.body, id: `${prefix}${String(highestId + 1).padStart(3, "0")}` };
    database[collection].push(record);

    try {
      await saveDatabase();
      res.status(201).json(record);
    } catch (error) {
      database[collection].pop();
      next(error);
    }
  });

  router.put("/:id", async (req, res, next) => {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "Request body must be a JSON object" });
    }
    const index = database[collection].findIndex(item => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Record not found" });

    const current = database[collection][index];
    const updated = { ...current, ...req.body, id: current.id };
    const error = validate(updated);
    if (error) return res.status(400).json({ error });

    database[collection][index] = updated;
    try {
      await saveDatabase();
      res.json(updated);
    } catch (error) {
      database[collection][index] = current;
      next(error);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    const index = database[collection].findIndex(item => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: "Record not found" });
    const [deleted] = database[collection].splice(index, 1);

    try {
      await saveDatabase();
      res.json({ message: "Record deleted", record: deleted });
    } catch (error) {
      database[collection].splice(index, 0, deleted);
      next(error);
    }
  });

  return router;
}

app.get("/", (req, res) => {
  res.json({
    name: "HRM API",
    endpoints: ["/api/employees", "/api/attendance", "/api/leave-requests"]
  });
});

app.get("/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/employees", createCrudRoutes("employees", collections.employees, validateEmployee));
app.use("/api/attendance", createCrudRoutes("attendance", collections.attendance, validateAttendance));
app.use("/api/leave-requests", createCrudRoutes("leaveRequests", collections.leaveRequests, validateLeaveRequest));

app.get("*", (req, res) => res.sendFile(path.join(PUBLIC_PATH, "index.html")));
app.use((req, res) => res.status(404).json({ error: "Endpoint not found" }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  database = JSON.parse(await fs.readFile(DATABASE_PATH, "utf8"));
  for (const collection of Object.keys(collections)) {
    if (!Array.isArray(database[collection])) {
      throw new Error(`Invalid database: ${collection} must be an array`);
    }
  }
  app.listen(PORT, () => {
    console.log(`HRM API listening on port ${PORT}`);
  });
}

start().catch(error => {
  console.error("Failed to start HRM API:", error);
  process.exitCode = 1;
});
