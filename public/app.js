const API = {
  employees: "/api/employees",
  attendance: "/api/attendance",
  leaveRequests: "/api/leave-requests"
};
const pageContent = document.getElementById("page-content");
const modal = document.getElementById("app-modal");
const modalContent = document.getElementById("modal-content");
const toastElement = document.getElementById("toast");
const appError = document.getElementById("app-error");
const appState = {
  employees: [],
  attendance: [],
  leaveRequests: [],
  page: "pulse",
  employeeQuery: "",
  department: "all",
  employeeView: "grid",
  selectedEmployee: "",
  timer: null,
  chartInstances: [],
  toastTimer: null
};

const avatarColors = ["#d99a86", "#8ea99a", "#d9b670", "#8e9dc1", "#b28aa8", "#73a9a0"];
const salaryByRole = {
  "software engineer": 112000,
  "product designer": 98000,
  "hr manager": 96000,
  "financial analyst": 87000,
  "marketing specialist": 81000,
  "operations coordinator": 74000
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function initials(employee) {
  return `${employee.firstName?.[0] || ""}${employee.lastName?.[0] || ""}`.toUpperCase();
}

function fullName(employee) {
  return `${employee.firstName || ""} ${employee.lastName || ""}`.trim();
}

function avatar(employee, extraClass = "") {
  const index = Math.max(0, appState.employees.findIndex(person => person.id === employee.id));
  return `<span class="avatar ${extraClass}" style="background:${avatarColors[index % avatarColors.length]}">${esc(initials(employee))}</span>`;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? esc(value) : new Intl.DateTimeFormat("en", options).format(date);
}

function formatCurrency(value, compact = false) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    notation: compact ? "compact" : "standard"
  }).format(value);
}

function annualSalary(employee) {
  const role = String(employee.position || "").toLowerCase();
  return salaryByRole[role] || (role.includes("manager") ? 95000 : 78000);
}

function monthlySalary(employee) {
  return Math.round(annualSalary(employee) / 12);
}

function employeeById(id) {
  return appState.employees.find(employee => employee.id === id);
}

function todayAttendance(employeeId) {
  return appState.attendance.find(log => log.employeeId === employeeId && log.date === localDateKey());
}

function setError(message = "") {
  appError.textContent = message;
  appError.hidden = !message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error || `Request failed (${response.status})`);
  return payload;
}

async function refreshData() {
  const [employees, attendance, leaveRequests] = await Promise.all([
    api(API.employees),
    api(API.attendance),
    api(API.leaveRequests)
  ]);
  appState.employees = employees;
  appState.attendance = attendance;
  appState.leaveRequests = leaveRequests;
  if (!appState.selectedEmployee || !employeeById(appState.selectedEmployee)) {
    appState.selectedEmployee = employees[0]?.id || "";
  }
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add("visible");
  clearTimeout(appState.toastTimer);
  appState.toastTimer = setTimeout(() => toastElement.classList.remove("visible"), 2800);
}

function updateHeaderDate() {
  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("en", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  }).format(new Date());
}

function setPage(page) {
  appState.page = page;
  document.querySelectorAll(".nav-link").forEach(link => {
    const active = link.dataset.page === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  renderPage();
}

function renderPage() {
  clearCharts();
  setError("");
  const renderers = {
    pulse: renderDashboard,
    directory: renderDirectory,
    attendance: renderAttendance,
    timeoff: renderTimeOff,
    payroll: renderPayroll
  };
  (renderers[appState.page] || renderDashboard)();
}

function clearCharts() {
  appState.chartInstances.forEach(chart => chart.destroy());
  appState.chartInstances = [];
}

function renderDashboard() {
  const activeEmployees = appState.employees.filter(employee => employee.employmentStatus !== "inactive");
  const todayLogs = appState.attendance.filter(log => log.date === localDateKey());
  const clockedIn = todayLogs.filter(log => log.checkIn && !log.checkOut).length;
  const pending = appState.leaveRequests.filter(request => request.status === "pending").length;
  const monthlyPayroll = activeEmployees.reduce((sum, employee) => sum + monthlySalary(employee), 0);
  const outToday = appState.leaveRequests.filter(request =>
    request.status === "approved" && request.startDate <= localDateKey() && request.endDate >= localDateKey()
  );
  const anniversaryPeople = upcomingAnniversaries();
  const departments = new Set(activeEmployees.map(employee => employee.department).filter(Boolean)).size;
  const attendanceDepartments = [...new Set(activeEmployees.map(employee => employee.department).filter(Boolean))].slice(0, 3);

  pageContent.innerHTML = `
    <div class="page-intro">
      <div><h2>Your people, at a glance</h2><p>A little snapshot of what’s happening across your team today.</p></div>
      <div class="intro-aside">Team health <strong>● Looking good</strong></div>
    </div>
    <div class="kpi-grid">
      <article class="card kpi-card"><div class="kpi-top"><span class="kpi-label">Active headcount</span><span class="kpi-icon"><svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20c.4-3 2.4-4.5 6-4.5s5.6 1.5 6 4.5m2-13a3 3 0 0 1 0 5.8M18 16c1.8.4 2.8 1.7 3 4"/></svg></span></div><div class="kpi-value">${activeEmployees.length}</div><div class="kpi-foot"><span class="trend-up">●</span> across ${departments} departments</div><span class="kpi-decoration"></span></article>
      <article class="card kpi-card"><div class="kpi-top"><span class="kpi-label">Clocked in today</span><span class="kpi-icon amber"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span></div><div class="kpi-value">${clockedIn}<small style="font-size:13px;color:#90a099;font-weight:600"> / ${activeEmployees.length}</small></div><div class="kpi-foot">Team members on shift</div><span class="kpi-decoration"></span></article>
      <article class="card kpi-card"><div class="kpi-top"><span class="kpi-label">Pending time-off</span><span class="kpi-icon coral"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 10h18m4 4h.01"/></svg></span></div><div class="kpi-value">${pending}</div><div class="kpi-foot">${pending ? "Requests waiting for review" : "You’re all caught up"}</div><span class="kpi-decoration"></span></article>
      <article class="card kpi-card"><div class="kpi-top"><span class="kpi-label">Monthly payroll</span><span class="kpi-icon"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-13 5h4"/></svg></span></div><div class="kpi-value">${formatCurrency(monthlyPayroll, true)}</div><div class="kpi-foot">Estimated gross · monthly</div><span class="kpi-decoration"></span></article>
    </div>
    <div class="dashboard-grid">
      <article class="card chart-card"><div class="section-heading"><div><h3>Department attendance</h3><p>Daily check-ins across your team · this week</p></div><span class="birthday-pill">THIS WEEK</span></div><div class="chart-legend">${attendanceDepartments.map((department, index) => `<span class="legend-item"><i class="legend-dot ${index === 1 ? "amber" : index === 2 ? "coral" : ""}"></i>${esc(department)}</span>`).join("")}</div><div class="chart-wrap"><canvas id="attendance-chart" aria-label="Department attendance area chart"></canvas></div></article>
      <article class="card chart-card"><div class="section-heading"><div><h3>Workforce distribution</h3><p>A team built from different strengths</p></div><button class="text-link" data-page="directory">Directory ↗</button></div><div class="chart-wrap"><canvas id="workforce-chart" aria-label="Workforce distribution donut chart"></canvas></div></article>
    </div>
    <div class="dashboard-bottom">
      <article class="card card-pad"><div class="section-heading"><div><h3>Who’s out today</h3><p>Approved time away, so the team can plan ahead</p></div><button class="text-link" data-page="timeoff">Leave hub ↗</button></div>
        ${outToday.length ? `<div class="mini-list">${outToday.map(request => { const employee = employeeById(request.employeeId); return employee ? `<div class="person-row">${avatar(employee)}<div class="person-info"><strong>${esc(fullName(employee))}</strong><small>${esc(request.type)} leave</small></div><span class="person-meta">${formatDate(request.endDate, { month: "short", day: "numeric" })} return</span></div>` : ""; }).join("")}</div>` : `<div class="empty-state">No one is away today — looks like the whole team is here 🌿</div>`}
      </article>
      <article class="card card-pad anniversary-card"><div class="section-heading"><div><h3>Upcoming anniversaries</h3><p>Little moments worth celebrating</p></div><span class="birthday-pill">✦ GOOD THINGS</span></div>
        ${anniversaryPeople.length ? `<div class="mini-list">${anniversaryPeople.slice(0, 3).map(item => `<div class="person-row">${avatar(item.employee)}<div class="person-info"><strong>${esc(fullName(item.employee))}</strong><small>${item.years} year${item.years === 1 ? "" : "s"} with us</small></div><span class="person-meta">${formatDate(item.date, { month: "short", day: "numeric" })}</span></div>`).join("")}</div>` : `<div class="empty-state">Your next team milestone is just around the corner.</div>`}
      </article>
    </div>`;
  drawAttendanceChart();
  drawWorkforceChart();
}

function upcomingAnniversaries() {
  const today = new Date();
  return appState.employees.flatMap(employee => {
    if (!employee.hireDate) return [];
    const hired = new Date(`${employee.hireDate}T12:00:00`);
    if (Number.isNaN(hired.getTime())) return [];
    let year = today.getFullYear();
    let date = new Date(year, hired.getMonth(), hired.getDate(), 12);
    if (date < new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)) {
      year += 1;
      date = new Date(year, hired.getMonth(), hired.getDate(), 12);
    }
    return [{ employee, date, years: year - hired.getFullYear() }];
  }).filter(item => item.years > 0).sort((a, b) => a.date - b.date);
}

function chartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: "#173c38", padding: 10, titleFont: { family: "DM Sans" }, bodyFont: { family: "DM Sans" }, displayColors: true, usePointStyle: true }
    }
  };
}

function drawAttendanceChart() {
  const canvas = document.getElementById("attendance-chart");
  if (!canvas || !window.Chart) return;
  const dates = [];
  const today = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    dates.push(date);
  }
  const departments = [...new Set(appState.employees.map(employee => employee.department).filter(Boolean))].slice(0, 3);
  const palette = ["#0f766e", "#f0ac36", "#e58a70"];
  const datasets = departments.map((department, index) => ({
    label: department,
    data: dates.map(date => {
      const key = localDateKey(date);
      const ids = appState.employees.filter(employee => employee.department === department).map(employee => employee.id);
      return appState.attendance.filter(log => log.date === key && ids.includes(log.employeeId) && log.checkIn).length;
    }),
    borderColor: palette[index],
    backgroundColor: `${palette[index]}20`,
    pointBackgroundColor: palette[index],
    pointBorderColor: "#fff",
    pointBorderWidth: 2,
    pointRadius: 3,
    pointHoverRadius: 5,
    borderWidth: 2,
    fill: true,
    tension: .42
  }));
  appState.chartInstances.push(new Chart(canvas, {
    type: "line",
    data: { labels: dates.map(date => new Intl.DateTimeFormat("en", { weekday: "short" }).format(date)), datasets },
    options: {
      ...chartDefaults(),
      interaction: { intersect: false, mode: "index" },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: "#9aa9a2", font: { family: "DM Sans", size: 9 } } },
        y: { beginAtZero: true, suggestedMax: 3, border: { display: false, dash: [4, 5] }, grid: { color: "#eff3f0" }, ticks: { stepSize: 1, color: "#9aa9a2", font: { family: "DM Sans", size: 9 }, precision: 0 } }
      }
    }
  }));
}

function drawWorkforceChart() {
  const canvas = document.getElementById("workforce-chart");
  if (!canvas || !window.Chart) return;
  const counts = new Map();
  appState.employees.filter(employee => employee.employmentStatus !== "inactive").forEach(employee => {
    counts.set(employee.department || "Other", (counts.get(employee.department || "Other") || 0) + 1);
  });
  const colors = ["#0f766e", "#efb64c", "#e98a72", "#94b8a2", "#99a7c7", "#c89dbe"];
  appState.chartInstances.push(new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: [...counts.keys()],
      datasets: [{ data: [...counts.values()], backgroundColor: colors, borderColor: "#fff", borderWidth: 4, hoverOffset: 6 }]
    },
    options: {
      ...chartDefaults(),
      cutout: "70%",
      plugins: {
        ...chartDefaults().plugins,
        legend: { display: true, position: "right", labels: { color: "#73857d", usePointStyle: true, pointStyle: "circle", boxWidth: 7, boxHeight: 7, padding: 14, font: { family: "DM Sans", size: 10 } } }
      }
    }
  }));
}

function filteredEmployees() {
  const query = appState.employeeQuery.trim().toLowerCase();
  return appState.employees.filter(employee => {
    const matchesDepartment = appState.department === "all" || employee.department === appState.department;
    const matchesQuery = !query || [employee.firstName, employee.lastName, employee.email, employee.position, employee.department]
      .some(value => String(value || "").toLowerCase().includes(query));
    return matchesDepartment && matchesQuery;
  });
}

function renderDirectory() {
  const employees = filteredEmployees();
  const departments = [...new Set(appState.employees.map(employee => employee.department).filter(Boolean))].sort();
  pageContent.innerHTML = `
    <div class="page-intro"><div><h2>Talent directory</h2><p>Good people doing good work. Meet the whole team.</p></div><div class="intro-aside"><strong>${appState.employees.length}</strong> team members</div></div>
    <div class="toolbar">
      <div class="toolbar-left"><label class="field-control search-control"><svg viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></svg><input id="employee-search" type="search" placeholder="Find a teammate..." value="${esc(appState.employeeQuery)}" aria-label="Search employees"></label>
        <select id="department-filter" class="field-control" aria-label="Filter by department"><option value="all">All departments</option>${departments.map(department => `<option value="${esc(department)}" ${appState.department === department ? "selected" : ""}>${esc(department)}</option>`).join("")}</select>
      </div>
      <div class="toolbar-right"><div class="segmented" aria-label="View mode"><button class="segment-button ${appState.employeeView === "grid" ? "selected" : ""}" type="button" data-view="grid" aria-label="Grid view"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></button><button class="segment-button ${appState.employeeView === "table" ? "selected" : ""}" type="button" data-view="table" aria-label="Table view"><svg viewBox="0 0 24 24"><path d="M4 5h16M4 12h16M4 19h16"/></svg></button></div><button class="button button-primary button-small" data-action="add-employee">＋ Add teammate</button></div>
    </div>
    ${employees.length ? appState.employeeView === "grid" ? `<div class="employee-grid">${employees.map(employeeCard).join("")}</div>` : employeeTable(employees) : `<div class="card empty-state">No teammates match that search. Try another name or department.</div>`}`;
}

function employeeCard(employee) {
  return `<article class="card employee-card"><div class="employee-card-top">${avatar(employee)}<span class="status-pill ${esc(employee.employmentStatus || "active")}">${esc(employee.employmentStatus || "active")}</span></div><h3>${esc(fullName(employee))}</h3><div class="employee-role">${esc(employee.position)}</div><div class="employee-card-meta"><span>✉ &nbsp;${esc(employee.email)}</span><span>◈ &nbsp;${esc(employee.department)}</span><span>Joined ${formatDate(employee.hireDate, { month: "long", year: "numeric" })}</span></div><div class="employee-card-footer"><small style="color:#9aa8a2;font-size:9px">${esc(employee.id)}</small><button class="icon-action" type="button" data-action="delete-employee" data-id="${esc(employee.id)}" aria-label="Delete ${esc(fullName(employee))}"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></div></article>`;
}

function employeeTable(employees) {
  return `<div class="card table-card employee-table-wrap"><table class="data-table"><thead><tr><th>Teammate</th><th>Department</th><th>Position</th><th>Joined</th><th>Status</th><th></th></tr></thead><tbody>${employees.map(employee => `<tr><td><div class="table-person">${avatar(employee)}<span>${esc(fullName(employee))}<small>${esc(employee.email)}</small></span></div></td><td>${esc(employee.department)}</td><td>${esc(employee.position)}</td><td>${formatDate(employee.hireDate)}</td><td><span class="status-pill ${esc(employee.employmentStatus || "active")}">${esc(employee.employmentStatus || "active")}</span></td><td><button class="icon-action" data-action="delete-employee" data-id="${esc(employee.id)}" aria-label="Delete ${esc(fullName(employee))}"><svg viewBox="0 0 24 24"><path d="M4 7h16m-10 4v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg></button></td></tr>`).join("")}</tbody></table></div>`;
}

function renderAttendance() {
  const today = localDateKey();
  const activeEmployee = employeeById(appState.selectedEmployee);
  const currentLog = activeEmployee ? todayAttendance(activeEmployee.id) : null;
  const isClockedIn = Boolean(currentLog?.checkIn && !currentLog?.checkOut);
  const presentToday = appState.attendance.filter(log => log.date === today && log.checkIn).length;
  const completedToday = appState.attendance.filter(log => log.date === today && log.checkOut).length;
  const hoursToday = appState.attendance.filter(log => log.date === today && log.checkIn && log.checkOut).reduce((sum, log) => sum + hoursBetween(log.checkIn, log.checkOut), 0);
  const logs = [...appState.attendance].sort((a, b) => `${b.date} ${b.checkIn || ""}`.localeCompare(`${a.date} ${a.checkIn || ""}`));
  pageContent.innerHTML = `
    <div class="page-intro"><div><h2>Live shift &amp; attendance</h2><p>A mindful way to keep track of the workday.</p></div><div class="intro-aside"><strong>${presentToday}</strong> clocked in today</div></div>
    <div class="shift-layout">
      <article class="card shift-card"><h3>Your shift, your rhythm</h3><p>Choose a teammate to clock in or out.</p>
        <select id="shift-employee" class="field-control shift-select" aria-label="Select employee">${appState.employees.map(employee => `<option value="${esc(employee.id)}" ${employee.id === appState.selectedEmployee ? "selected" : ""}>${esc(fullName(employee))}</option>`).join("")}</select>
        <div class="live-time" id="live-timer">${isClockedIn ? elapsedLabel(currentLog) : "00:00:00"}</div><div class="live-date">${new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}</div>
        <span class="shift-status ${isClockedIn ? "active" : ""}"><i></i>${isClockedIn ? "You’re on the clock" : "Not clocked in"}</span>
        <button class="button ${isClockedIn ? "button-danger" : "button-primary"} shift-button" data-action="toggle-shift" ${activeEmployee ? "" : "disabled"}>${isClockedIn ? "Clock out" : "Clock in"} <span>${isClockedIn ? "↗" : "→"}</span></button>
        <div class="shift-hint">Take breaks when you need them. Your time is saved automatically.</div>
      </article>
      <div class="attendance-panel"><div class="shift-summary"><div class="summary-chip"><strong>${presentToday}</strong><small>Clocked in today</small></div><div class="summary-chip"><strong>${completedToday}</strong><small>Shift completed</small></div><div class="summary-chip"><strong>${hoursToday.toFixed(1)}h</strong><small>Hours tracked today</small></div></div>
        <article class="card table-card"><div class="section-heading"><div><h3>Attendance log</h3><p>Recent check-ins from across your team</p></div></div><div class="table-wrap">${attendanceTable(logs)}</div></article>
      </div>
    </div>`;
  startTimer(isClockedIn ? currentLog : null);
}

function hoursBetween(start, end) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return Math.max(0, (endHour * 60 + endMinute - startHour * 60 - startMinute) / 60);
}

function elapsedLabel(log) {
  if (!log?.checkIn) return "00:00:00";
  const started = new Date(`${log.date}T${log.checkIn}:00`);
  const total = Math.max(0, Math.floor((Date.now() - started.getTime()) / 1000));
  const hours = String(Math.floor(total / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function startTimer(log) {
  clearInterval(appState.timer);
  if (!log) return;
  appState.timer = setInterval(() => {
    const timer = document.getElementById("live-timer");
    if (timer) timer.textContent = elapsedLabel(log);
  }, 1000);
}

function attendanceTable(logs) {
  if (!logs.length) return `<div class="empty-state">No attendance records yet. Clock in to create the first log.</div>`;
  return `<table class="data-table"><thead><tr><th>Teammate</th><th>Date</th><th>Clock in</th><th>Clock out</th><th>Hours</th><th>Status</th></tr></thead><tbody>${logs.slice(0, 12).map(log => {
    const employee = employeeById(log.employeeId);
    const hours = log.checkIn && log.checkOut ? `${hoursBetween(log.checkIn, log.checkOut).toFixed(1)}h` : "—";
    return `<tr><td><div class="table-person">${employee ? avatar(employee) : ""}<span>${employee ? esc(fullName(employee)) : esc(log.employeeId)}</span></div></td><td>${formatDate(log.date)}</td><td>${esc(log.checkIn || "—")}</td><td>${esc(log.checkOut || "—")}</td><td>${hours}</td><td><span class="status-pill ${esc(log.status)}">${esc(log.status)}</span></td></tr>`;
  }).join("")}</tbody></table>`;
}

function leaveBalance(employee) {
  if (!employee) return { annual: 20, annualUsed: 0, sick: 10, sickUsed: 0, personal: 5, personalUsed: 0 };
  const currentYear = new Date().getFullYear();
  const balance = { annual: 20, annualUsed: 0, sick: 10, sickUsed: 0, personal: 5, personalUsed: 0 };
  appState.leaveRequests.filter(request => request.employeeId === employee.id && request.status === "approved" && new Date(`${request.startDate}T12:00:00`).getFullYear() === currentYear)
    .forEach(request => {
      const start = new Date(`${request.startDate}T12:00:00`);
      const end = new Date(`${request.endDate}T12:00:00`);
      const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
      if (request.type === "annual") balance.annualUsed += days;
      else if (request.type === "sick") balance.sickUsed += days;
      else balance.personalUsed += days;
    });
  return balance;
}

function renderTimeOff() {
  const pending = appState.leaveRequests.filter(request => request.status === "pending");
  const employee = employeeById(appState.selectedEmployee);
  const balance = leaveBalance(employee);
  const requests = [...appState.leaveRequests].sort((a, b) => b.startDate.localeCompare(a.startDate));
  pageContent.innerHTML = `
    <div class="page-intro"><div><h2>Time-off &amp; leave hub</h2><p>Rest is part of the work. Manage time away with care.</p></div><div class="intro-aside"><strong>${pending.length}</strong> request${pending.length === 1 ? "" : "s"} to review</div></div>
    <div class="leave-layout">
      <article class="card leave-balance"><div class="section-heading"><div><h3>Leave balance</h3><p>Available days for ${employee ? esc(fullName(employee)) : "your team"}</p></div><select id="leave-employee" class="field-control" aria-label="Choose employee for leave balance">${appState.employees.map(person => `<option value="${esc(person.id)}" ${person.id === appState.selectedEmployee ? "selected" : ""}>${esc(fullName(person))}</option>`).join("")}</select></div>
        <div class="balance-list">${balanceRow("Annual leave", balance.annualUsed, balance.annual, "")}${balanceRow("Sick leave", balance.sickUsed, balance.sick, "amber")}${balanceRow("Personal days", balance.personalUsed, balance.personal, "coral")}</div>
      </article>
      <aside class="leave-callout"><span class="callout-icon">☀</span><h3>Rest is productive.</h3><p>A thoughtful break can make all the difference. Here’s to making space for life outside work, too.</p><div class="leave-count">${pending.length} pending ${pending.length === 1 ? "request" : "requests"} to review</div></aside>
    </div>
    <article class="card table-card" style="margin-top:16px"><div class="section-heading"><div><h3>All leave requests</h3><p>Review and update your team’s requests</p></div></div><div class="table-wrap">${leaveTable(requests)}</div></article>`;
}

function balanceRow(label, used, total, colorClass) {
  const available = Math.max(0, total - used);
  const percent = total ? Math.min(100, (available / total) * 100) : 0;
  return `<div class="balance-row"><div class="balance-label"><span>${label}</span><strong>${available} <span style="color:#93a29b;font-weight:500">of ${total} days left</span></strong></div><div class="balance-track"><div class="balance-fill ${colorClass}" style="width:${percent}%"></div></div></div>`;
}

function leaveTable(requests) {
  if (!requests.length) return `<div class="empty-state">No leave requests yet. That’s a well-rested team.</div>`;
  return `<table class="data-table"><thead><tr><th>Teammate</th><th>Type</th><th>Dates</th><th>Reason</th><th>Status</th><th>Actions</th></tr></thead><tbody>${requests.map(request => {
    const employee = employeeById(request.employeeId);
    return `<tr><td><div class="table-person">${employee ? avatar(employee) : ""}<span>${employee ? esc(fullName(employee)) : esc(request.employeeId)}</span></div></td><td style="text-transform:capitalize">${esc(request.type)}</td><td>${formatDate(request.startDate, { month: "short", day: "numeric" })} – ${formatDate(request.endDate, { month: "short", day: "numeric", year: "numeric" })}</td><td>${esc(request.reason || "—")}</td><td><span class="status-pill ${esc(request.status)}">${esc(request.status)}</span></td><td>${request.status === "pending" ? `<div class="leave-actions"><button class="button button-quiet button-small" data-action="leave-status" data-status="approved" data-id="${esc(request.id)}">Approve</button><button class="button button-danger button-small" data-action="leave-status" data-status="rejected" data-id="${esc(request.id)}">Reject</button></div>` : "—"}</td></tr>`;
  }).join("")}</tbody></table>`;
}

function renderPayroll() {
  const employees = appState.employees.filter(employee => employee.employmentStatus !== "inactive");
  const gross = employees.reduce((sum, employee) => sum + monthlySalary(employee), 0);
  const deductions = Math.round(gross * .27);
  const takeHome = gross - deductions;
  pageContent.innerHTML = `
    <div class="page-intro"><div><h2>Payroll &amp; payslips</h2><p>Clear, considered compensation — all in one place.</p></div><div class="intro-aside">ESTIMATES · USD</div></div>
    <div class="payroll-summary">
      <article class="card payroll-highlight"><div><small>Estimated monthly gross</small><strong>${formatCurrency(gross)}</strong><small style="display:block;margin-top:4px">Across ${employees.length} active teammates</small></div><span class="kpi-icon"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 10h18m-13 5h4"/></svg></span></article>
      <article class="card payroll-mini"><small>Estimated deductions</small><strong>${formatCurrency(deductions)}</strong></article>
      <article class="card payroll-mini"><small>Estimated take-home</small><strong>${formatCurrency(takeHome)}</strong></article>
    </div>
    <p class="payroll-disclaimer">Planning estimates only. Salary figures are illustrative role-based estimates, not actual payroll records.</p>
    <article class="card table-card"><div class="section-heading"><div><h3>Monthly compensation overview</h3><p>Open a payslip preview for a sample salary breakdown.</p></div><span class="birthday-pill">MONTHLY</span></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Teammate</th><th>Department</th><th>Annual estimate</th><th>Monthly gross</th><th>Est. take-home</th><th></th></tr></thead><tbody>${employees.map(employee => {
        const monthly = monthlySalary(employee);
        const net = Math.round(monthly * .73);
        return `<tr><td><div class="table-person">${avatar(employee)}<span>${esc(fullName(employee))}<small>${esc(employee.position)}</small></span></div></td><td>${esc(employee.department)}</td><td>${formatCurrency(annualSalary(employee))}</td><td class="salary-amount">${formatCurrency(monthly)}</td><td>${formatCurrency(net)}</td><td><button class="button button-quiet button-small" data-action="payslip" data-id="${esc(employee.id)}">View payslip</button></td></tr>`;
      }).join("")}</tbody></table></div>
    </article>`;
}

function showModal(content) {
  modalContent.innerHTML = content;
  modal.showModal();
}

function closeModal() {
  modal.close();
  modalContent.innerHTML = "";
}

function showAddEmployeeModal() {
  showModal(`<div class="modal-inner"><div class="modal-header"><div><h2 id="modal-title">Add a teammate</h2><p>A warm welcome starts with the basics.</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></div>
    <form id="employee-form" class="modal-form">
      <div class="form-field"><label for="firstName">First name</label><input id="firstName" name="firstName" required maxlength="80"></div>
      <div class="form-field"><label for="lastName">Last name</label><input id="lastName" name="lastName" required maxlength="80"></div>
      <div class="form-field full"><label for="email">Work email</label><input id="email" name="email" type="email" required maxlength="160"></div>
      <div class="form-field"><label for="department">Department</label><input id="department" name="department" list="department-options" required maxlength="100"><datalist id="department-options">${[...new Set(appState.employees.map(employee => employee.department).filter(Boolean))].map(department => `<option value="${esc(department)}">`).join("")}</datalist></div>
      <div class="form-field"><label for="position">Job title</label><input id="position" name="position" required maxlength="100"></div>
      <div class="form-field full"><label for="hireDate">Start date</label><input id="hireDate" name="hireDate" type="date" value="${localDateKey()}" required></div>
      <div class="modal-actions form-field full"><button class="button button-outline" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Add teammate</button></div>
    </form></div>`);
  document.getElementById("firstName").focus();
}

function showPayslip(employee) {
  const gross = monthlySalary(employee);
  const federal = Math.round(gross * .18);
  const benefits = Math.round(gross * .04);
  const retirement = Math.round(gross * .05);
  const net = gross - federal - benefits - retirement;
  showModal(`<div class="modal-inner"><div class="modal-header"><div><h2 id="modal-title">Payslip preview</h2><p>${esc(fullName(employee))} · ${new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date())}</p></div><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></div>
    <div class="payslip-brand"><span class="brand-mark"><span></span><span></span><span></span></span> AURA HR <span style="margin-left:auto;color:#99a8a2;font:500 9px 'DM Sans',sans-serif">ESTIMATE · USD</span></div>
    <div class="payslip-lines"><div class="payslip-line"><span>Monthly gross pay</span><strong>${formatCurrency(gross)}</strong></div><div class="payslip-line"><span>Estimated tax withholding</span><strong>− ${formatCurrency(federal)}</strong></div><div class="payslip-line"><span>Benefits contribution</span><strong>− ${formatCurrency(benefits)}</strong></div><div class="payslip-line"><span>Retirement contribution</span><strong>− ${formatCurrency(retirement)}</strong></div><div class="payslip-line total"><span>Estimated take-home</span><strong>${formatCurrency(net)}</strong></div></div>
    <div class="modal-actions"><button class="button button-primary" type="button" data-action="close-modal">Done</button></div></div>`);
}

function exportEmployeesCsv() {
  const rows = [
    ["Employee ID", "First name", "Last name", "Email", "Department", "Position", "Hire date", "Status"],
    ...appState.employees.map(employee => [
      employee.id, employee.firstName, employee.lastName, employee.email, employee.department, employee.position, employee.hireDate, employee.employmentStatus || "active"
    ])
  ];
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `aura-hr-employees-${localDateKey()}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported ${rows.length - 1} employee record${rows.length === 2 ? "" : "s"} to CSV.`);
}

async function withRefresh(successMessage) {
  try {
    await refreshData();
    renderPage();
    if (successMessage) showToast(successMessage);
  } catch (error) {
    setError(error.message);
    showToast(error.message);
  }
}

async function toggleShift() {
  const employee = employeeById(appState.selectedEmployee);
  if (!employee) return;
  const record = todayAttendance(employee.id);
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  try {
    if (record?.checkIn && !record.checkOut) {
      await api(`${API.attendance}/${encodeURIComponent(record.id)}`, {
        method: "PUT",
        body: JSON.stringify({ checkOut: time })
      });
      await withRefresh(`${fullName(employee)} clocked out at ${time}.`);
    } else if (record) {
      showToast("This teammate already has an attendance record for today.");
    } else {
      await api(API.attendance, {
        method: "POST",
        body: JSON.stringify({
          employeeId: employee.id,
          date: localDateKey(),
          checkIn: time,
          checkOut: null,
          status: "present"
        })
      });
      await withRefresh(`${fullName(employee)} clocked in at ${time}.`);
    }
  } catch (error) {
    setError(error.message);
    showToast(error.message);
  }
}

async function deleteEmployee(id) {
  const employee = employeeById(id);
  if (!employee || !window.confirm(`Remove ${fullName(employee)} from the directory?`)) return;
  try {
    await api(`${API.employees}/${encodeURIComponent(id)}`, { method: "DELETE" });
    await withRefresh(`${fullName(employee)} was removed.`);
  } catch (error) {
    setError(error.message);
    showToast(error.message);
  }
}

async function updateLeaveStatus(id, status) {
  try {
    await api(`${API.leaveRequests}/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ status })
    });
    await withRefresh(`Leave request ${status}.`);
  } catch (error) {
    setError(error.message);
    showToast(error.message);
  }
}

document.addEventListener("click", async event => {
  const pageLink = event.target.closest("[data-page]");
  if (pageLink) {
    event.preventDefault();
    const page = pageLink.dataset.page;
    if (page === "directory" && appState.page !== "directory" && appState.employeeQuery) {
      appState.employeeQuery = "";
      document.getElementById("global-search").value = "";
    }
    setPage(page);
    return;
  }
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    appState.employeeView = viewButton.dataset.view;
    renderDirectory();
    return;
  }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  switch (action.dataset.action) {
    case "add-employee": showAddEmployeeModal(); break;
    case "close-modal": closeModal(); break;
    case "delete-employee": await deleteEmployee(action.dataset.id); break;
    case "toggle-shift": await toggleShift(); break;
    case "leave-status": await updateLeaveStatus(action.dataset.id, action.dataset.status); break;
    case "payslip": {
      const employee = employeeById(action.dataset.id);
      if (employee) showPayslip(employee);
      break;
    }
    case "export-csv": exportEmployeesCsv(); break;
  }
});

document.addEventListener("input", event => {
  if (event.target.id === "employee-search") {
    appState.employeeQuery = event.target.value;
    const cursor = event.target.selectionStart;
    renderDirectory();
    const search = document.getElementById("employee-search");
    search.focus();
    search.setSelectionRange(cursor, cursor);
  }
  if (event.target.id === "global-search") {
    appState.employeeQuery = event.target.value;
    if (event.target.value && appState.page !== "directory") setPage("directory");
    else if (appState.page === "directory") renderDirectory();
  }
});

document.addEventListener("change", event => {
  if (event.target.id === "department-filter") {
    appState.department = event.target.value;
    renderDirectory();
  }
  if (event.target.id === "shift-employee" || event.target.id === "leave-employee") {
    appState.selectedEmployee = event.target.value;
    renderPage();
  }
});

document.addEventListener("submit", async event => {
  if (event.target.id !== "employee-form") return;
  event.preventDefault();
  const formData = new FormData(event.target);
  const employee = Object.fromEntries(formData.entries());
  employee.employmentStatus = "active";
  try {
    await api(API.employees, { method: "POST", body: JSON.stringify(employee) });
    closeModal();
    await refreshData();
    appState.page = "directory";
    appState.employeeQuery = "";
    document.getElementById("global-search").value = "";
    setPage("directory");
    showToast(`${employee.firstName} has been added to the team.`);
  } catch (error) {
    setError(error.message);
    showToast(error.message);
  }
});

document.getElementById("global-search").addEventListener("keydown", event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    event.currentTarget.focus();
  }
});

async function initialize() {
  updateHeaderDate();
  try {
    await refreshData();
    renderPage();
  } catch (error) {
    setError(`Could not load the HRM workspace: ${error.message}. Make sure the Express server is running.`);
    pageContent.innerHTML = `<div class="card card-pad"><h2 style="font:700 17px Manrope,sans-serif">Your workspace is taking a moment</h2><p style="color:#82938f;font-size:12px">We couldn’t connect to the HRM API. Try refreshing once the server is available.</p><button class="button button-primary" type="button" data-action="retry">Try again</button></div>`;
  }
}

document.addEventListener("click", async event => {
  if (event.target.closest('[data-action="retry"]')) {
    await initialize();
  }
});

initialize();
