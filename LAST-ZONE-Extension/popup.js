document.addEventListener("DOMContentLoaded", () => {
    const keyInput = document.getElementById("keyInput");
    const activateBtn = document.getElementById("activateBtn");
    const statusMsg = document.getElementById("statusMsg");

    const serverUrlInput = document.getElementById("serverUrlInput");
    const saveServerBtn = document.getElementById("saveServerBtn");
    const serverStatusBadge = document.getElementById("serverStatusBadge");

    // Pre-fill key if saved
    chrome.runtime.sendMessage({ action: "getLicense" }, (lic) => {
        if (lic && lic.license_key) {
            keyInput.value = lic.license_key;
        }
    });

    // Server Config & Health Check
    function checkServerHealth(url) {
        if (!serverStatusBadge) return;
        serverStatusBadge.textContent = "Connecting...";
        serverStatusBadge.style.color = "#ffa502";
        serverStatusBadge.style.background = "rgba(255,165,2,0.2)";

        fetch(`${url}/health`, { method: "GET" })
            .then(r => r.json())
            .then(data => {
                if (data && data.status === "ok") {
                    serverStatusBadge.textContent = "🟢 Online";
                    serverStatusBadge.style.color = "#00d2d3";
                    serverStatusBadge.style.background = "rgba(0,210,211,0.2)";
                } else {
                    throw new Error("Invalid status");
                }
            })
            .catch(() => {
                serverStatusBadge.textContent = "🔴 Offline";
                serverStatusBadge.style.color = "#ff4757";
                serverStatusBadge.style.background = "rgba(255,71,87,0.2)";
            });
    }

    chrome.runtime.sendMessage({ action: "getServerConfig" }, (cfg) => {
        if (cfg && cfg.serverUrl) {
            if (serverUrlInput) serverUrlInput.value = cfg.serverUrl;
            checkServerHealth(cfg.serverUrl);
        }
    });

    if (saveServerBtn && serverUrlInput) {
        saveServerBtn.addEventListener("click", () => {
            const url = (serverUrlInput.value.trim() || "http://52.21.185.77:3000").replace(/\/+$/, "");
            saveServerBtn.textContent = "...";
            chrome.runtime.sendMessage({
                action: "setServerConfig",
                serverUrl: url,
                apiKey: "your-secret-api-key-change-this"
            }, () => {
                saveServerBtn.textContent = "Saved";
                setTimeout(() => saveServerBtn.textContent = "Save", 1500);
                checkServerHealth(url);
            });
        });
    }

    activateBtn.addEventListener("click", () => {
        const key = keyInput.value.trim();
        if (!key) return;

        activateBtn.disabled = true;
        activateBtn.textContent = "Activating...";
        statusMsg.style.display = "none";

        chrome.runtime.sendMessage({ action: "verifyLicense", key }, (res) => {
            activateBtn.disabled = false;
            activateBtn.textContent = "Activate License";
            statusMsg.style.display = "block";

            if (res && res.ok) {
                statusMsg.className = "status-msg status-success";
                statusMsg.textContent = "✓ License Activated Successfully!";
            } else {
                statusMsg.className = "status-msg status-error";
                statusMsg.textContent = "✗ " + ((res && res.message) || "Activation Failed");
            }
        });
    });
});
