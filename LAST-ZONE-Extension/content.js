// =========================================================================
// LAST ZONE - Content Script (ISOLATED World)
// Bridges license & device credentials to in-page inject.js
// =========================================================================

(function() {
    if (window.__lastZoneIsolatedInstalled) return;
    window.__lastZoneIsolatedInstalled = true;

    function injectMainScript() {
        try {
            const script = document.createElement("script");
            script.src = chrome.runtime.getURL("inject.js");
            script.onload = function() { this.remove(); };
            script.onerror = function() {
                fetch(chrome.runtime.getURL("inject.js"))
                    .then(r => r.text())
                    .then(code => {
                        const inline = document.createElement("script");
                        inline.textContent = code;
                        (document.head || document.documentElement).appendChild(inline);
                        inline.remove();
                    });
            };
            (document.head || document.documentElement).appendChild(script);
        } catch(e) {
            console.error("[LAST ZONE] Script injection error:", e);
        }
    }

    function syncLicenseData() {
        try {
            chrome.storage.local.get(["bruno_license", "bruno_device_id", "bruno_invite_url"], (res) => {
                window.postMessage({
                    type: "LASTZONE_DATA_SYNC",
                    license: res.bruno_license || null,
                    deviceId: res.bruno_device_id || "dev-default",
                    inviteUrl: res.bruno_invite_url || ""
                }, "*");
            });
        } catch(_) {}
    }

    window.addEventListener("message", (ev) => {
        if (ev.source !== window || !ev.data) return;
        if (ev.data.type === "LASTZONE_REQUEST_DATA" || ev.data.type === "BRUNO_REQUEST_DATA") {
            syncLicenseData();
        }
        if (ev.data.type === "LASTZONE_SAVE_INVITE_URL") {
            const url = (ev.data.inviteUrl !== undefined && ev.data.inviteUrl !== null) ? String(ev.data.inviteUrl).trim() : "";
            try {
                chrome.storage.local.set({ bruno_invite_url: url }, () => {
                    window.postMessage({ type: "LASTZONE_INVITE_URL_SAVED", inviteUrl: url }, "*");
                });
            } catch(_) {}
        }
        if (ev.data.type === "LASTZONE_LOGOUT") {
            chrome.runtime.sendMessage({ action: "logoutLicense" }, () => {
                window.postMessage({ type: "LASTZONE_LOGOUT_SUCCESS" }, "*");
            });
        }
        if (ev.data.type === "LASTZONE_VERIFY_KEY") {
            chrome.runtime.sendMessage({ action: "verifyLicense", key: ev.data.key }, (result) => {
                window.postMessage({ type: "LASTZONE_VERIFY_RESULT", result: result }, "*");
                if (result && result.ok) {
                    syncLicenseData();
                }
            });
        }
        if (ev.data.type === "LASTZONE_GET_SWITCH_QUOTE" || ev.data.type === "LASTZONE_GET_SWITCH_POLICY") {
            chrome.runtime.sendMessage({
                action: "getSwitchQuote",
                licenseKey: ev.data.licenseKey
            }, (result) => {
                window.postMessage({ type: ev.data.type === "LASTZONE_GET_SWITCH_POLICY" ? "LASTZONE_POLICY_RESULT" : "LASTZONE_QUOTE_RESULT", result: result }, "*");
            });
        }
        if (ev.data.type === "LASTZONE_TRIGGER_SWITCH") {
            chrome.runtime.sendMessage({
                action: "switchAccount",
                slot: ev.data.slot,
                licenseKey: ev.data.licenseKey,
                inviteUrl: ev.data.inviteUrl || null
            }, (result) => {
                window.postMessage({ type: "LASTZONE_SWITCH_RESULT", result: result }, "*");
            });
        }
    });

    function checkLiveLicense() {
        try {
            chrome.runtime.sendMessage({ action: "verifyLicenseLive" }, (res) => {
                if (res && !res.ok && res.deactivated) {
                    window.postMessage({
                        type: "LASTZONE_FORCE_LOGOUT",
                        message: res.message || "License deactivated by administrator"
                    }, "*");
                }
            });
        } catch(_) {}
    }

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "forceLicenseLogout") {
            window.postMessage({
                type: "LASTZONE_FORCE_LOGOUT",
                message: msg.message || "License deactivated by administrator"
            }, "*");
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && (changes.bruno_license || changes.bruno_device_id || changes.bruno_invite_url)) {
            syncLicenseData();
        }
    });

    window.addEventListener("focus", checkLiveLicense);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) checkLiveLicense();
    });

    setInterval(checkLiveLicense, 10000);

    injectMainScript();
    syncLicenseData();
    checkLiveLicense();
})();
