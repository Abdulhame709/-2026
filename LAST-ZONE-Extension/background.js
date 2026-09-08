// =========================================================================
// LAST ZONE - Background Service Worker (Secure Thin Client)
// NO Service Role Keys! All verification runs in Server RPCs
// =========================================================================

const SUPABASE_URL = "https://hdwacqhkfxledujodhft.supabase.co";
const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhkd2FjcWhrZnhsZWR1am9kaGZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NTc5NjMsImV4cCI6MjEwNDAzMzk2M30.mQFUK_Y2SRLPX1g7MYt6jTgLHMmGKPQB-eleT8rKqeU";

async function getDeviceId() {
    const data = await chrome.storage.local.get(["bruno_device_id"]);
    if (data.bruno_device_id) return data.bruno_device_id;
    const newId = "dev-" + Math.random().toString(36).substring(2, 10) + "-" + Date.now().toString(36);
    await chrome.storage.local.set({ bruno_device_id: newId });
    return newId;
}

async function verifyLicense(licenseKey) {
    try {
        const cleanKey = String(licenseKey || "").trim().toUpperCase();
        if (!cleanKey) return { ok: false, message: "Please enter a license key" };

        const deviceId = await getDeviceId();
        const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/verify_user_license", {
            method: "POST",
            headers: {
                "apikey": ANON_KEY,
                "Authorization": "Bearer " + ANON_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                p_license_key: cleanKey,
                p_device_id: deviceId
            })
        });

        const result = await res.json();
        if (result && result.ok) {
            await chrome.storage.local.set({ bruno_license: result.license });
            return { ok: true, license: result.license };
        } else {
            await chrome.storage.local.remove(["bruno_license"]);
            return { ok: false, message: (result && result.message) || "Invalid or deactivated license key", deactivated: true };
        }
    } catch(e) {
        return { ok: false, message: e.message || "Failed to verify license" };
    }
}

// Clear ONLY the extension's license key, never touch website session
async function logoutLicense() {
    await chrome.storage.local.remove(["bruno_license"]);
    return { ok: true };
}

chrome.runtime.onInstalled.addListener(async () => {
    await getDeviceId();
});

chrome.runtime.onStartup.addListener(async () => {
    const current = await chrome.storage.local.get(["bruno_license"]);
    if (current.bruno_license && current.bruno_license.license_key) {
        await verifyLicense(current.bruno_license.license_key);
    }
});

// =========================================================================
// ACCOUNT SWITCHER ENGINE (Connects to VPS / Local Backend Server)
// =========================================================================
const DEFAULT_SERVER_URL = "http://52.21.185.77:3000";
const DEFAULT_API_KEY = "your-secret-api-key-change-this";

async function getServerConfig() {
    const data = await chrome.storage.local.get(["account_switcher_server_url", "account_switcher_api_key"]);
    let url = data.account_switcher_server_url;
    if (!url || url.includes("localhost") || url.includes("127.0.0.1") || url.includes("44.209.218.68") || !url.includes("52.21.185.77")) {
        url = DEFAULT_SERVER_URL;
        await chrome.storage.local.set({ account_switcher_server_url: DEFAULT_SERVER_URL });
    }
    return {
        serverUrl: url,
        apiKey: data.account_switcher_api_key || DEFAULT_API_KEY
    };
}

async function switchAccount(slotNum, licenseKey, inviteUrl) {
    try {
        // 1. Get license key from argument or local storage
        let key = licenseKey;
        if (!key) {
            const stored = await chrome.storage.local.get(["bruno_license"]);
            if (stored.bruno_license && stored.bruno_license.license_key) {
                key = stored.bruno_license.license_key;
            }
        }

        if (!key) {
            return { ok: false, message: "No active license key found. Please activate your license.", deactivated: true };
        }

        // 2. CHECK DIRECTLY WITH SUPABASE FIRST! If key is invalid or inactive, NEVER touch our VPS server!
        const liveCheck = await verifyLicense(key);
        if (!liveCheck || !liveCheck.ok) {
            await chrome.storage.local.remove(["bruno_license"]);
            return {
                ok: false,
                message: (liveCheck && liveCheck.message) || "Invalid or deactivated license key. Switch blocked.",
                deactivated: true
            };
        }

        const { serverUrl, apiKey } = await getServerConfig();
        console.log(`[LAST ZONE] 🔄 Switch requested for verified License: ${key} via ${serverUrl}...${inviteUrl ? ' with Invite: ' + inviteUrl : ''}`);

        // 3. Multi-tenant: binds or retrieves dedicated account for this user from VPS
        const res = await fetch(`${serverUrl}/api/switch`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey
            },
            body: JSON.stringify({ licenseKey: key, inviteUrl: inviteUrl || null })
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            const err = new Error(errData.message || errData.error || errData.details || `Server returned error (${res.status})`);
            err.rechargeRequired = (errData.error === "INSUFFICIENT_CREDITS" || res.status === 402);
            err.errorCode = errData.error;
            err.remainingSeconds = errData.remaining_seconds;
            err.cost = errData.cost;
            err.currentCredits = errData.currentCredits;
            if (errData.deactivated || errData.error === "LICENSE_INACTIVE" || errData.error === "LICENSE_NOT_FOUND" || errData.error === "LICENSE_EXPIRED" || res.status === 403) {
                err.deactivated = true;
                await chrome.storage.local.remove(["bruno_license"]);
            }
            throw err;
        }

        const data = await res.json();
        if (!data || !data.success || !data.session) {
            throw new Error("Invalid session response received from server");
        }

        // Update local license credit balance if returned
        if (data.credits !== undefined && key) {
            try {
                const stored = await chrome.storage.local.get(["bruno_license"]);
                if (stored.bruno_license) {
                    stored.bruno_license.credits = data.credits;
                    stored.bruno_license.switch_count = data.switchCount;
                    await chrome.storage.local.set({ bruno_license: stored.bruno_license });
                }
            } catch(_) {}
        }

        const sessionCookies = data.session.cookies || [];
        console.log(`[LAST ZONE] Received ${sessionCookies.length} cookies. Clearing old cookies & injecting...`);

        // 3. Clear ALL existing lovable.dev cookies (exact domain and all subdomains)
        try {
            const allCookies = await chrome.cookies.getAll({});
            for (const c of allCookies) {
                if (c.domain && c.domain.includes("lovable.dev")) {
                    const protocol = c.secure ? "https:" : "http:";
                    const cleanDomain = c.domain.replace(/^\./, "");
                    const url = `${protocol}//${cleanDomain}${c.path || "/"}`;
                    try {
                        await chrome.cookies.remove({ url, name: c.name, storeId: c.storeId });
                    } catch(_) {}
                }
            }
            console.log("[LAST ZONE] 🧹 All previous lovable.dev cookies wiped clean.");
        } catch(cookieErr) {
            console.warn("[LAST ZONE] Cookie purge error:", cookieErr);
        }

        // 4. Inject all new cookies
        let injectedCount = 0;
        for (const c of sessionCookies) {
            if (!c.domain || !c.domain.includes("lovable.dev")) continue;

            const protocol = c.secure ? "https:" : "http:";
            const cleanDomain = c.domain.startsWith(".") ? c.domain.substring(1) : c.domain;
            const url = `${protocol}//${cleanDomain}${c.path || "/"}`;

            const details = {
                url,
                name: c.name,
                value: c.value,
                path: c.path || "/",
                secure: c.secure !== undefined ? !!c.secure : true,
                httpOnly: c.httpOnly !== undefined ? !!c.httpOnly : false
            };

            if (c.domain && c.domain.startsWith(".")) {
                details.domain = c.domain;
            }

            if (c.sameSite) {
                const s = String(c.sameSite).toLowerCase();
                if (s === "none" || s === "no_restriction") {
                    details.sameSite = "no_restriction";
                    details.secure = true;
                } else if (s === "lax") {
                    details.sameSite = "lax";
                } else if (s === "strict") {
                    details.sameSite = "strict";
                }
            }

            if (c.expirationDate && c.expirationDate > 0) {
                details.expirationDate = Math.floor(c.expirationDate);
            } else if (c.expires && c.expires > 0) {
                details.expirationDate = Math.floor(c.expires);
            }

            try {
                await chrome.cookies.set(details);
                injectedCount++;
            } catch(err) {
                console.warn("[LAST ZONE] Cookie set warning:", c.name, err);
            }
        }

        console.log(`[LAST ZONE] ✅ Successfully injected ${injectedCount} cookies for account ${data.label || accountId}!`);

        return {
            ok: true,
            accountId: data.accountId,
            email: data.email,
            label: data.label,
            credits: data.credits,
            deductedCredits: data.deductedCredits,
            switchCount: data.switchCount,
            dailySwitchesCount: data.dailySwitchesCount,
            dailySwitchLimit: data.dailySwitchLimit,
            dailySwitchesRemaining: data.dailySwitchesRemaining,
            cooldownSeconds: data.cooldownSeconds,
            cooldownRemainingSeconds: data.cooldownRemainingSeconds,
            lastSwitchAt: data.lastSwitchAt,
            targetUrl: data.targetUrl,
            invitationAccepted: data.invitationAccepted,
            session: {
                localStorage: data.session.localStorage || {}
            }
        };
    } catch(err) {
        console.error("[LAST ZONE] Account switch failed:", err);
        return {
            ok: false,
            message: err.message || "Failed to connect to backend server",
            error: err.errorCode,
            remainingSeconds: err.remainingSeconds,
            rechargeRequired: !!err.rechargeRequired,
            deactivated: !!err.deactivated,
            cost: err.cost,
            currentCredits: err.currentCredits
        };
    }
}

async function getSwitchQuote(licenseKey) {
    try {
        const { serverUrl, apiKey } = await getServerConfig();
        let key = licenseKey;
        if (!key) {
            const stored = await chrome.storage.local.get(["bruno_license"]);
            if (stored.bruno_license && stored.bruno_license.license_key) {
                key = stored.bruno_license.license_key;
            }
        }
        if (!key) return { ok: false, message: "No active license key found", deactivated: true };

        // Verify with Supabase directly first! If invalid, NEVER call VPS!
        const liveCheck = await verifyLicense(key);
        if (!liveCheck || !liveCheck.ok) {
            await chrome.storage.local.remove(["bruno_license"]);
            return {
                ok: false,
                message: (liveCheck && liveCheck.message) || "Invalid or deactivated license key",
                deactivated: true
            };
        }

        const res = await fetch(`${serverUrl}/api/switch/quote?licenseKey=${encodeURIComponent(key)}`, {
            headers: { "x-api-key": apiKey }
        });
        const quote = await res.json().catch(() => ({}));
        if (quote && (quote.deactivated || quote.error === "LICENSE_INACTIVE" || quote.error === "LICENSE_NOT_FOUND" || quote.error === "LICENSE_EXPIRED" || res.status === 403)) {
            quote.deactivated = true;
            await chrome.storage.local.remove(["bruno_license"]);
        }
        return quote;
    } catch(err) {
        return { ok: false, message: err.message || "Failed to reach server" };
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "verifyLicense") {
        verifyLicense(msg.key).then(sendResponse);
        return true;
    } else if (msg.action === "verifyLicenseLive") {
        chrome.storage.local.get(["bruno_license"], async (res) => {
            if (res.bruno_license && res.bruno_license.license_key) {
                const check = await verifyLicense(res.bruno_license.license_key);
                if (!check.ok && check.deactivated) {
                    await chrome.storage.local.remove(["bruno_license"]);
                }
                sendResponse(check);
            } else {
                sendResponse({ ok: false, deactivated: false, noLicense: true });
            }
        });
        return true;
    } else if (msg.action === "getLicense") {
        chrome.storage.local.get(["bruno_license"], async (res) => {
            if (res.bruno_license && res.bruno_license.license_key) {
                const check = await verifyLicense(res.bruno_license.license_key);
                if (check.ok) {
                    sendResponse(check.license);
                } else {
                    sendResponse(null);
                }
                return;
            }
            sendResponse(null);
        });
        return true;
    } else if (msg.action === "getDeviceId") {
        getDeviceId().then(sendResponse);
        return true;
    } else if (msg.action === "logoutLicense") {
        logoutLicense().then(sendResponse);
        return true;
    } else if (msg.action === "getSwitchQuote") {
        getSwitchQuote(msg.licenseKey).then(sendResponse);
        return true;
    } else if (msg.action === "switchAccount") {
        switchAccount(msg.slot, msg.licenseKey, msg.inviteUrl).then(sendResponse);
        return true;
    } else if (msg.action === "getServerConfig") {
        getServerConfig().then(sendResponse);
        return true;
    } else if (msg.action === "setServerConfig") {
        chrome.storage.local.set({
            account_switcher_server_url: msg.serverUrl,
            account_switcher_api_key: msg.apiKey
        }).then(() => sendResponse({ ok: true }));
        return true;
    }
});
