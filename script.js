const STATUS_CLASS_MAP = {
  green: "status-green",
  red: "status-red",
  blue: "status-blue",
  orange: "status-orange",
  yellow: "status-yellow"
};

const DEMO_DATA = {
  factionName: "Warband of the Fallen",
  members: [
    {
      name: "Astra Vale",
      level: 98,
      position: "Leader",
      status: { description: "Online", color: "green" },
      last_action: { relative: "2 minutes ago" },
      is_revivable: false
    },
    {
      name: "Kestrel Voss",
      level: 84,
      position: "Deputy",
      status: { description: "Idle", color: "yellow" },
      last_action: { relative: "18 minutes ago" },
      is_revivable: true
    },
    {
      name: "Morrow Dane",
      level: 76,
      position: "Recruiter",
      status: { description: "Traveling", color: "blue" },
      last_action: { relative: "1 hour ago" },
      is_revivable: false
    },
    {
      name: "Iris Noct",
      level: 61,
      position: "Member",
      status: { description: "Hospital", color: "red" },
      last_action: { relative: "3 hours ago" },
      is_revivable: true
    }
  ]
};

const form = document.getElementById("faction-form");
const factionNameInput = document.getElementById("faction-name");
const apiKeyInput = document.getElementById("api-key");
const demoButton = document.getElementById("demo-button");
const memberBody = document.getElementById("member-body");
const factionTitle = document.getElementById("faction-title");
const memberCount = document.getElementById("member-count");
const dataSource = document.getElementById("data-source");
const message = document.getElementById("message");

function setMessage(text) {
  message.textContent = text;
}

function setSummary(name, count, source) {
  factionTitle.textContent = name || "Unknown faction";
  memberCount.textContent = String(count);
  dataSource.textContent = source;
}

function statusClass(color) {
  return STATUS_CLASS_MAP[color] || "status-default";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderMembers(members) {
  if (!members.length) {
    memberBody.innerHTML = '<tr class="empty-row"><td colspan="6">No members found.</td></tr>';
    return;
  }

  memberBody.innerHTML = members
    .map((member) => {
      const status = member.status || {};
      const revive = member.is_revivable ? '<span class="revive-badge revive-yes">Yes</span>' : "";

      return `
        <tr>
          <td>${escapeHtml(member.name ?? "")}</td>
          <td>${escapeHtml(member.level ?? "")}</td>
          <td>${escapeHtml(member.position ?? "")}</td>
          <td><span class="status-badge ${statusClass(status.color)}">${escapeHtml(status.description ?? "")}</span></td>
          <td>${revive}</td>
          <td>${escapeHtml(member.last_action?.relative ?? "")}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadFactionFromApi(factionName, apiKey) {
  const searchResponse = await fetch(`https://api.torn.com/v2/faction/search?name=${encodeURIComponent(factionName)}`, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${apiKey}`
    }
  });

  if (!searchResponse.ok) {
    throw new Error(`Faction search failed (${searchResponse.status})`);
  }

  const searchData = await searchResponse.json();
  const factionId = searchData?.search?.[0]?.id;

  if (!factionId) {
    throw new Error("No faction match found.");
  }

  const membersResponse = await fetch(`https://api.torn.com/v2/faction/${factionId}/members`, {
    headers: {
      Accept: "application/json",
      Authorization: `ApiKey ${apiKey}`
    }
  });

  if (!membersResponse.ok) {
    throw new Error(`Member lookup failed (${membersResponse.status})`);
  }

  const membersData = await membersResponse.json();
  return {
    factionName,
    members: Object.values(membersData?.members || {})
  };
}

async function showDemoData() {
  setMessage("Rendering demo roster.");
  renderMembers(DEMO_DATA.members);
  setSummary(DEMO_DATA.factionName, DEMO_DATA.members.length, "Demo data");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const factionName = factionNameInput.value.trim();
  const apiKey = apiKeyInput.value.trim();

  if (!factionName) {
    setMessage("Enter a faction name first.");
    return;
  }

  if (!apiKey) {
    setMessage("Add a Torn API key or use the demo view.");
    return;
  }

  setMessage("Loading roster from Torn API...");
  setSummary(factionName, "...", "Live API");

  try {
    const data = await loadFactionFromApi(factionName, apiKey);
    renderMembers(data.members);
    setSummary(data.factionName, data.members.length, "Live API");
    setMessage("Roster loaded successfully.");
  } catch (error) {
    console.error(error);
    setMessage(error instanceof Error ? error.message : "Unable to load faction data.");
    setSummary(factionName, 0, "Error");
    memberBody.innerHTML = '<tr class="empty-row"><td colspan="6">No roster loaded yet.</td></tr>';
  }
});

demoButton.addEventListener("click", showDemoData);

showDemoData();