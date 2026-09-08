// =========================================================================
// LAST ZONE v9.7.2 - Secure Thin Client Engine
// Brand: LAST ZONE | Official Logo | Enlarged Floating UI (440px)
// Dual View In-Floating-Panel: Dashboard View & Activation View
// =========================================================================

(function() {
    if (window.__lastZoneMainInstalled) return;
    window.__lastZoneMainInstalled = true;

    console.log(
        "%c[LAST ZONE v9.7.2] ⚡ Engine Active (Connected to Your Supabase Server)",
        "color: #ba42ff; font-size: 13px; font-weight: bold; background: #0c071a; padding: 5px 12px; border-radius: 6px; border: 1px solid #ba42ff;"
    );

    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch(_) {}

    const _fetch = window.fetch;
    const SUPABASE_URL = "https://hdwacqhkfxledujodhft.supabase.co";
    const ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhkd2FjcWhrZnhsZWR1am9kaGZ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0NTc5NjMsImV4cCI6MjEwNDAzMzk2M30.mQFUK_Y2SRLPX1g7MYt6jTgLHMmGKPQB-eleT8rKqeU";
    const LOGO_URI = "data:image/png;base64,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";
    const TG_CHANNEL = "https://t.me/+Dm8IppPh39s4YWIx";
    const TG_SUPPORT = "https://t.me/monir_i0_0i";

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    let license = null;
    let deviceId = "dev-init";
    let isSynced = false;
    let currentServerSlot = 1;
    let savedInviteUrl = "";
    try {
        savedInviteUrl = window.localStorage.getItem("lastzone_saved_invite_url") || "";
    } catch(_) {}

    let switchPolicy = {
        dailyLimit: 20,
        dailyCount: 0,
        dailyRemaining: 20,
        cooldownSeconds: 180,
        lastSwitchAt: null
    };
    try {
        const sp = window.localStorage.getItem("lastzone_switch_policy");
        if (sp) {
            const parsed = JSON.parse(sp);
            if (parsed && typeof parsed === "object") switchPolicy = Object.assign(switchPolicy, parsed);
        }
    } catch(_) {}

    function calculateCooldownRemainingSeconds() {
        if (!switchPolicy.lastSwitchAt) return 0;
        const lastTime = new Date(switchPolicy.lastSwitchAt).getTime();
        if (isNaN(lastTime)) return 0;
        const cooldownSecs = switchPolicy.cooldownSeconds || 180;
        const elapsedSecs = Math.floor((Date.now() - lastTime) / 1000);
        const rem = cooldownSecs - elapsedSecs;
        return rem > 0 ? rem : 0;
    }

    window.__DS_LICENSE__ = license;

    // Listen for license data from extension background/content
    window.addEventListener("message", function(ev) {
        if (ev.source !== window || !ev.data) return;
        if (ev.data.type === "BRUNO_DATA_SYNC" || ev.data.type === "LASTZONE_DATA_SYNC") {
            if (ev.data.license && ev.data.license.license_key) {
                license = ev.data.license;
                window.__DS_LICENSE__ = license;
                isSynced = true;
                showDashboardView();
                updateWidgetUI();
                replaceLovableCreditsDOM(license.credits);
            } else {
                license = null;
                window.__DS_LICENSE__ = null;
                isSynced = false;
                showActivateView();
                updateWidgetUI();
            }
            if (ev.data.deviceId) {
                deviceId = ev.data.deviceId;
            }
            if (ev.data.inviteUrl !== undefined && ev.data.inviteUrl !== null) {
                savedInviteUrl = String(ev.data.inviteUrl).trim();
                try {
                    if (savedInviteUrl) {
                        window.localStorage.setItem("lastzone_saved_invite_url", savedInviteUrl);
                    }
                } catch(_) {}
                const dashInput = document.getElementById("ds-dashboard-invite-url");
                if (dashInput && !dashInput.value && savedInviteUrl) {
                    dashInput.value = savedInviteUrl;
                }
            }
        }

        if (ev.data.type === "LASTZONE_VERIFY_RESULT") {
            handleVerificationResult(ev.data.result);
        }

        if (ev.data.type === "LASTZONE_POLICY_RESULT") {
            handlePolicyResult(ev.data.result);
        }

        if (ev.data.type === "LASTZONE_QUOTE_RESULT") {
            handleQuoteResult(ev.data.result);
        }

        if (ev.data.type === "LASTZONE_SWITCH_RESULT") {
            handleSwitchResult(ev.data.result);
        }

        if (ev.data.type === "LASTZONE_FORCE_LOGOUT") {
            console.warn("[LAST ZONE] 🚨 Force logout triggered:", ev.data.message);
            const banner = document.getElementById("ds-switch-banner");
            if (banner) banner.remove();
            const modal = document.getElementById("ds-confirm-modal-overlay");
            if (modal) modal.remove();

            performLicenseLogout();
            showActivateView();
            const statusMsg = document.getElementById("ds-panel-status-msg");
            if (statusMsg) {
                statusMsg.style.display = "block";
                statusMsg.style.color = "#ff4757";
                statusMsg.textContent = "⛔ " + (ev.data.message || "License deactivated by administrator");
            }
        }
    });

    try { window.postMessage({ type: "LASTZONE_REQUEST_DATA" }, "*"); } catch(_) {}

    // =========================================================================
    // 1. IN-PANEL VIEW TOGGLING (Inside the Floating Card Itself!)
    // =========================================================================
    function showActivateView(presetKey) {
        const dashView = document.getElementById("ds-view-dashboard");
        const actView = document.getElementById("ds-view-activate");
        const exitBtn = document.getElementById("ds-exit-btn");
        const keyInput = document.getElementById("ds-panel-key-input");
        const statusMsg = document.getElementById("ds-panel-status-msg");

        if (dashView) dashView.style.display = "none";
        if (actView) actView.style.display = "flex";
        if (exitBtn) exitBtn.style.display = "none";
        if (statusMsg) statusMsg.style.display = "none";

        if (keyInput) {
            keyInput.value = presetKey || (license && license.license_key) || "";
            setTimeout(() => keyInput.focus(), 150);
        }
    }

    function showDashboardView() {
        const dashView = document.getElementById("ds-view-dashboard");
        const actView = document.getElementById("ds-view-activate");
        const exitBtn = document.getElementById("ds-exit-btn");

        if (dashView) dashView.style.display = "flex";
        if (actView) actView.style.display = "none";
        if (exitBtn) exitBtn.style.display = "flex";

        updateSwitchPolicyUI();
        fetchPolicyLive();
    }

    function fetchPolicyLive() {
        const licKey = (license && license.license_key) || null;
        if (licKey) {
            window.postMessage({ type: "LASTZONE_GET_SWITCH_POLICY", licenseKey: licKey }, "*");
        }
    }

    function handlePolicyResult(quote) {
        if (!quote || typeof quote !== "object") return;
        if (quote.daily_switch_limit !== undefined) switchPolicy.dailyLimit = quote.daily_switch_limit;
        if (quote.daily_switches_count !== undefined) switchPolicy.dailyCount = quote.daily_switches_count;
        if (quote.daily_switches_remaining !== undefined) switchPolicy.dailyRemaining = quote.daily_switches_remaining;
        if (quote.switch_cooldown_seconds !== undefined) switchPolicy.cooldownSeconds = quote.switch_cooldown_seconds;
        if (quote.last_switch_at !== undefined && quote.last_switch_at !== null) switchPolicy.lastSwitchAt = quote.last_switch_at;
        try { window.localStorage.setItem("lastzone_switch_policy", JSON.stringify(switchPolicy)); } catch(_) {}
        updateSwitchPolicyUI();
    }

    function updateSwitchPolicyUI() {
        const dailyBadge = document.getElementById("ds-daily-switches-badge");
        const dailyStatus = document.getElementById("ds-daily-limit-status");
        const cooldownCard = document.getElementById("ds-cooldown-card");
        const timerText = document.getElementById("ds-cooldown-timer-text");
        const switchBtn = document.getElementById("ds-switch-btn");
        const switchText = document.getElementById("ds-switch-btn-text");
        const switchIcon = document.getElementById("ds-switch-btn-icon");

        const remCooldown = calculateCooldownRemainingSeconds();
        const limit = (switchPolicy.dailyLimit !== undefined) ? switchPolicy.dailyLimit : 20;
        const remainingDaily = (switchPolicy.dailyRemaining !== undefined) ? switchPolicy.dailyRemaining : Math.max(0, limit - (switchPolicy.dailyCount || 0));

        // 1. Update Daily Switches badge
        if (dailyBadge) {
            if (limit <= 0) {
                dailyBadge.textContent = "Unlimited VIP";
                dailyBadge.style.color = "#00d2d3";
            } else if (remainingDaily <= 0) {
                dailyBadge.textContent = `0 / ${limit}`;
                dailyBadge.style.color = "#ff4757";
                dailyBadge.style.borderColor = "rgba(255, 71, 87, 0.4)";
                dailyBadge.style.background = "rgba(255, 71, 87, 0.15)";
                if (dailyStatus) {
                    dailyStatus.textContent = "⛔ Limit Reached";
                    dailyStatus.style.color = "#ff4757";
                }
            } else {
                dailyBadge.textContent = `${remainingDaily} / ${limit}`;
                dailyBadge.style.color = "#00d2d3";
                dailyBadge.style.borderColor = "rgba(0, 210, 211, 0.35)";
                dailyBadge.style.background = "rgba(0, 210, 211, 0.12)";
                if (dailyStatus) {
                    dailyStatus.textContent = "Active";
                    dailyStatus.style.color = "#a55eea";
                }
            }
        }

        // 2. Update Cooldown Box & Switch Button
        if (remCooldown > 0) {
            const m = Math.floor(remCooldown / 60);
            const s = remCooldown % 60;
            const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

            if (cooldownCard) cooldownCard.style.display = "flex";
            if (timerText) timerText.textContent = timeStr;

            if (switchBtn && !switchBtn.__isConnecting) {
                switchBtn.disabled = true;
                switchBtn.style.opacity = "0.65";
                switchBtn.style.cursor = "not-allowed";
                if (switchText) switchText.textContent = `Cooldown (${timeStr})`;
                if (switchIcon) switchIcon.textContent = "⏳";
            }
        } else {
            if (cooldownCard) cooldownCard.style.display = "none";

            if (switchBtn && !switchBtn.__isConnecting) {
                if (limit > 0 && remainingDaily <= 0) {
                    switchBtn.disabled = true;
                    switchBtn.style.opacity = "0.55";
                    switchBtn.style.cursor = "not-allowed";
                    if (switchText) switchText.textContent = "Daily Limit Reached";
                    if (switchIcon) switchIcon.textContent = "⛔";
                } else {
                    switchBtn.disabled = false;
                    switchBtn.style.opacity = "1";
                    switchBtn.style.cursor = "pointer";
                    if (switchText) switchText.textContent = "Switch";
                    if (switchIcon) switchIcon.textContent = "🔄";
                }
            }
        }
    }

    function handleVerificationResult(res) {
        const actBtn = document.getElementById("ds-panel-activate-btn");
        const statusMsg = document.getElementById("ds-panel-status-msg");

        if (actBtn) {
            actBtn.disabled = false;
            actBtn.textContent = "Activate License";
        }

        if (statusMsg) {
            statusMsg.style.display = "block";
            if (res && res.ok) {
                statusMsg.style.color = "#00d2d3";
                statusMsg.textContent = "✓ License Activated Successfully!";
                license = res.license;
                window.__DS_LICENSE__ = license;
                isSynced = true;
                setTimeout(() => {
                    showDashboardView();
                    updateWidgetUI();
                }, 700);
            } else {
                statusMsg.style.color = "#ff4757";
                statusMsg.textContent = "✗ " + ((res && res.message) || "Activation Failed");
            }
        }
    }

    // =========================================================================
    // 2. LOGOUT LICENSE (Switches View inside the Floating Card)
    // =========================================================================
    function performLicenseLogout() {
        console.log("%c[LAST ZONE] 🔑 Logged out of license. Switching to Activation in floating card...", "color:#ba42ff; font-weight:bold;");
        const oldKey = (license && license.license_key) || "";

        // Delete from chrome.storage
        try { window.postMessage({ type: "LASTZONE_LOGOUT" }, "*"); } catch(_) {}

        license = null;
        window.__DS_LICENSE__ = null;
        isSynced = false;

        updateWidgetUI();

        // Switch floating panel to Activate License view right inside the card
        showActivateView(oldKey);
    }

    // =========================================================================
    // 3. SERVER-DRIVEN FETCH INTERCEPTOR
    // =========================================================================
    window.fetch = async function(input, init) {
        let url = "";
        let method = "GET";

        if (typeof input === "string") {
            url = input;
            method = init?.method || "GET";
        } else if (input instanceof Request) {
            url = input.url;
            method = input.method || init?.method || "GET";
        } else if (input instanceof URL) {
            url = input.href;
            method = init?.method || "GET";
        }

        method = String(method || "GET").toUpperCase();

        let bodyText = "";
        if (init && typeof init.body === "string") {
            bodyText = init.body;
        }

        const isChat = (method === "POST" || method === "PUT") && (url.includes("/chat") || url.includes("chat"));

        if (isChat) {
            try {
                if (!bodyText && input instanceof Request) {
                    try { bodyText = await input.clone().text(); } catch(_) {}
                }

                if (bodyText) {
                    let body = JSON.parse(bodyText);
                    let userPrompt = "";
                    if (typeof body.message === "string") {
                        userPrompt = body.message;
                    } else if (typeof body.text === "string") {
                        userPrompt = body.text;
                    } else if (typeof body.content === "string") {
                        userPrompt = body.content;
                    } else if (Array.isArray(body.content)) {
                        const textPart = body.content.find(p => p && (p.type === "text" || typeof p.text === "string"));
                        if (textPart) userPrompt = textPart.text || "";
                    }

                    if (!userPrompt && Array.isArray(body.messages) && body.messages.length > 0) {
                        const lastMsg = body.messages[body.messages.length - 1];
                        if (typeof lastMsg === "string") {
                            userPrompt = lastMsg;
                        } else if (lastMsg && typeof lastMsg.content === "string") {
                            userPrompt = lastMsg.content;
                        } else if (lastMsg && Array.isArray(lastMsg.content)) {
                            const textPart = lastMsg.content.find(p => p && (p.type === "text" || typeof p.text === "string"));
                            if (textPart) userPrompt = textPart.text || "";
                        }
                    }

                    const hasAttachments = (body.attachments?.length || body.images?.length || body.files?.length || body.file_attachments?.length || body.media?.length);
                    if (!userPrompt && hasAttachments) {
                        userPrompt = "Please process and analyze the attached files/images.";
                    }

                    if (userPrompt) {
                        const licKey = license?.license_key;
                        if (!licKey) {
                            console.warn("[LAST ZONE] No active license. Please activate license.");
                            const panel = document.getElementById("ds-panel");
                            if (panel) panel.style.display = "flex";
                            showActivateView();
                            return _fetch.apply(window, arguments);
                        }

                        console.log("%c[LAST ZONE] 🔒 Requesting Secure Payload from Server...", "color: #ba42ff; font-weight: bold;");

                        const rpcRes = await _fetch(SUPABASE_URL + "/rest/v1/rpc/prepare_injection_payload", {
                            method: "POST",
                            headers: {
                                "apikey": ANON_KEY,
                                "Authorization": "Bearer " + ANON_KEY,
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                p_license_key: licKey,
                                p_user_prompt: userPrompt,
                                p_device_id: deviceId
                            })
                        });

                        const rpcData = await rpcRes.json();

                        if (rpcData && rpcData.ok && rpcData.payload) {
                            const serverPayload = rpcData.payload;

                            if (rpcData.credits_remaining !== undefined && license) {
                                license.credits = rpcData.credits_remaining;
                                updateWidgetUI();
                                replaceLovableCreditsDOM(license.credits);
                            }

                            const syncEl = document.getElementById("ds-sync-status");
                            if (syncEl) {
                                syncEl.innerHTML = `<span>🟢 Verified by Server (${rpcData.credits_remaining} pts)</span>`;
                                syncEl.style.color = "#00d2d3";
                            }

                            console.log(
                                "%c[LAST ZONE] ⚡ Injected Server Payload Successfully | Verified by DB | Credits remaining:", 
                                "color: #00d2d3; font-weight: bold;", 
                                rpcData.credits_remaining
                            );

                            // BUILD FINAL PAYLOAD: Preserves all attachments, files, images, and context from original body
                            const finalPayload = {
                                ...body,
                                ...serverPayload
                            };

                            // 1. Maintain prompt text in all possible prompt fields
                            if (serverPayload.message) {
                                if (body.message !== undefined || (!body.text && !body.content)) {
                                    finalPayload.message = serverPayload.message;
                                }
                                if (body.text !== undefined) {
                                    finalPayload.text = serverPayload.message;
                                }
                                if (typeof body.content === "string") {
                                    finalPayload.content = serverPayload.message;
                                } else if (Array.isArray(body.content)) {
                                    let foundText = false;
                                    finalPayload.content = body.content.map(part => {
                                        if (part && (part.type === "text" || typeof part.text === "string")) {
                                            foundText = true;
                                            return { ...part, text: serverPayload.message };
                                        }
                                        return part;
                                    });
                                    if (!foundText) {
                                        finalPayload.content.unshift({ type: "text", text: serverPayload.message });
                                    }
                                }
                            }

                            // 2. Preserve messages array if present
                            if (Array.isArray(body.messages) && body.messages.length > 0) {
                                const lastIdx = body.messages.length - 1;
                                finalPayload.messages = body.messages.map((msg, idx) => {
                                    if (idx === lastIdx && serverPayload.message) {
                                        if (typeof msg === "string") return serverPayload.message;
                                        if (msg && typeof msg === "object") {
                                            if (typeof msg.content === "string") {
                                                return { ...msg, content: serverPayload.message };
                                            } else if (Array.isArray(msg.content)) {
                                                let textFound = false;
                                                const newContent = msg.content.map(p => {
                                                    if (p && (p.type === "text" || typeof p.text === "string")) {
                                                        textFound = true;
                                                        return { ...p, text: serverPayload.message };
                                                    }
                                                    return p;
                                                });
                                                if (!textFound) {
                                                    newContent.unshift({ type: "text", text: serverPayload.message });
                                                }
                                                return { ...msg, content: newContent };
                                            }
                                        }
                                    }
                                    return msg;
                                });
                            }

                            // 3. Guarantee all attachments, images, and files from original body are strictly preserved
                            if (body.attachments !== undefined) finalPayload.attachments = body.attachments;
                            if (body.images !== undefined) finalPayload.images = body.images;
                            if (body.files !== undefined) finalPayload.files = body.files;
                            if (body.file_attachments !== undefined) finalPayload.file_attachments = body.file_attachments;
                            if (body.media !== undefined) finalPayload.media = body.media;
                            if (body.documents !== undefined) finalPayload.documents = body.documents;
                            if (body.context !== undefined) finalPayload.context = body.context;
                            if (body.project_id !== undefined) finalPayload.project_id = body.project_id;
                            if (body.projectId !== undefined) finalPayload.projectId = body.projectId;

                            const attCount = (body.attachments?.length || 0) + (body.images?.length || 0) + (body.files?.length || 0) + (body.file_attachments?.length || 0);
                            if (attCount > 0) {
                                console.log(`%c[LAST ZONE] 📎 Preserving ${attCount} attachment(s)/file(s) in payload`, "color: #2ed573; font-weight: bold;");
                            }

                            const cleanInit = { method: method, body: JSON.stringify(finalPayload), headers: {} };
                            const src = init?.headers || (input instanceof Request ? input.headers : null);
                            if (src instanceof Headers) {
                                src.forEach((v, k) => cleanInit.headers[k] = v);
                            } else if (src && typeof src === "object") {
                                Object.assign(cleanInit.headers, src);
                            }
                            if (!cleanInit.headers["Content-Type"] && !cleanInit.headers["content-type"]) {
                                cleanInit.headers["Content-Type"] = "application/json";
                            }
                            delete cleanInit.headers["Content-Length"];
                            delete cleanInit.headers["content-length"];

                            const opts = ["credentials","mode","cache","redirect","referrer","referrerPolicy","integrity","keepalive","signal"];
                            const ref = init || (input instanceof Request ? input : {});
                            for (const k of opts) {
                                if (ref[k] !== undefined) cleanInit[k] = ref[k];
                            }
                            if (!cleanInit.credentials) cleanInit.credentials = "include";

                            return await _fetch.call(window, url, cleanInit);
                        } else {
                            console.warn("[LAST ZONE] Server refused payload:", rpcData && rpcData.message);
                            const syncEl = document.getElementById("ds-sync-status");
                            if (syncEl && rpcData) {
                                syncEl.textContent = "⚠️ " + (rpcData.message || "License check failed");
                                syncEl.style.color = "#ff4757";
                            }
                            const panel = document.getElementById("ds-panel");
                            if (panel) panel.style.display = "flex";
                            showActivateView(licKey);
                            const actStatus = document.getElementById("ds-panel-status-msg");
                            if (actStatus && rpcData) {
                                actStatus.style.display = "block";
                                actStatus.style.color = "#ff4757";
                                actStatus.textContent = "⚠️ " + (rpcData.message || "Key not verified");
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("[LAST ZONE] Interceptor Error:", err);
            }
        }

        return _fetch.apply(window, arguments);
    };

    // =========================================================================
    // 4. DOM BRAND CAMOUFLAGE & ABUSE SUPPRESSOR
    // =========================================================================
    let _replacingBrand = false;
    function replaceBrandBadgesDOM() {
        if (_replacingBrand) return;
        _replacingBrand = true;
        try {
            const brandText = "LAST ZONE . . .";
            const goodLuckText = "Good luck ✨";
            const dangerWarningText = "⚠️ Please switch the server and stop this prompt immediately ⚠️";

            function hasCamouflageTarget(t) {
                if (!t || typeof t !== "string") return false;
                return /For\s+the\s+code\s+present|Please\s+think\s+step-by-step|^Task:\s*|error\s*TS\d+:|Type\s*['"]?number['"]?\s*is\s*not\s*assignable|fix(?:ing)?\s*errors?/i.test(t);
            }

            const candidates = document.querySelectorAll('p, span, div, button, [role="button"], [class*="badge"], [class*="card"], code, pre, em, strong');
            candidates.forEach(el => {
                if (el.closest("#ds-floating-widget") || el.closest("#ds-server-switch-overlay")) return;

                const rawTxt = (el.textContent || "").trim();
                if (!rawTxt || !hasCamouflageTarget(rawTxt)) return;

                // Deepest element check: if any child element also matches, let the child handle it
                const childMatches = Array.from(el.children).some(child => hasCamouflageTarget(child.textContent || ""));
                if (childMatches) return;

                let txt = (el.textContent || "").trim();
                let modified = false;
                let isDanger = false;
                let isLuck = false;
                let isBrand = false;
                let isHidden = false;

                // 1. Combined full prompt (when rendered together in a single container)
                const rxFull = /For\s+the\s+code\s+present[\s\S]*?Please\s+think\s+step-by-step[\s\S]*?Task:\s*([\s\S]*)$/i;
                const matchFull = txt.match(rxFull);
                if (matchFull) {
                    const userPart = (matchFull[1] || "").trim();
                    txt = dangerWarningText + (userPart ? "\n\n" + userPart : "");
                    modified = true;
                    isDanger = true;
                } else if (/For\s+the\s+code\s+present/i.test(txt)) {
                    txt = dangerWarningText;
                    modified = true;
                    isDanger = true;
                } else if (/Please\s+think\s+step-by-step/i.test(txt)) {
                    txt = "";
                    modified = true;
                    isHidden = true;
                } else if (/^Task:\s*/i.test(txt)) {
                    txt = txt.replace(/^Task:\s*/i, "").trim();
                    modified = true;
                } else if (/error\s*TS\d+:|Type\s*['"]?number['"]?\s*is\s*not\s*assignable/i.test(txt)) {
                    txt = txt.replace(/error\s*TS\d+:\s*Type\s*['"]?number['"]?\s*is\s*not\s*assignable\s*to\s*type\s*['"]?string['"]?\.?|Type\s*['"]?number['"]?\s*is\s*not\s*assignable\s*to\s*type\s*['"]?string['"]?\.?/gi, goodLuckText);
                    modified = true;
                    isLuck = true;
                } else if (/fix(?:ing)?\s*errors?/i.test(txt)) {
                    txt = txt.replace(/fix(?:ing)?\s*errors?/gi, brandText);
                    modified = true;
                    isBrand = true;
                }

                if (modified && el.textContent !== txt) {
                    el.textContent = txt;
                    if (isHidden) {
                        el.style.display = "none";
                    } else if (isDanger) {
                        el.style.color = "#fbbf24";
                        el.style.fontWeight = "600";
                        el.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
                        el.style.letterSpacing = "0.2px";
                    } else if (isLuck) {
                        el.style.color = "#00d2d3";
                        el.style.fontWeight = "bold";
                    } else if (isBrand) {
                        el.style.color = "#ba42ff";
                        el.style.fontWeight = "bold";
                    }
                }
            });
        } catch(_) {}
        finally {
            _replacingBrand = false;
        }
    }

    function suppressAbuseAlertsDOM() {
        try {
            const rxAbuse = /(?:Unusual\s*["“']?Try to fix["”']?\s*activity|credit abuse alerts|Credit abuse violates|free\s*["“']?Try to fix["”']?\s*function)/i;
            const candidates = document.querySelectorAll('p, span, div, [role="alert"]');
            candidates.forEach(el => {
                if (el.closest("#ds-floating-widget") || el.closest("#ds-server-switch-overlay")) return;
                if (el.children.length === 0 && el.textContent && rxAbuse.test(el.textContent)) {
                    let card = el.closest('div[role="alert"]') || el.parentElement;
                    if (card && card !== document.body) {
                        card.style.setProperty("display", "none", "important");
                    }
                }
            });
        } catch(_) {}
    }

    let _isReplacingCredits = false;
    function replaceLovableCreditsDOM(customCredits) {
        if (customCredits === undefined || customCredits === null) return;
        if (_isReplacingCredits) return;
        _isReplacingCredits = true;
        try {
            const targetNum = parseInt(customCredits) || 0;
            const targetStr = targetNum.toLocaleString('en-US');

            const targetParagraphs = document.querySelectorAll(
                '[class*="group/credits-card"] [class*="gap-px"] p, [class*="gap-px"] p, [class*="group/credits-card"] p[class*="text-tertiary-pulse"], div[role="button"] [class*="gap-px"] p'
            );

            targetParagraphs.forEach(p => {
                if (!p || p.closest("#ds-floating-widget") || p.closest("#ds-server-switch-overlay")) return;
                const txt = (p.textContent || "").trim();
                if (/Daily credits|reset at midnight/i.test(txt)) return;
                const isArabic = /متبقي|متبقية/i.test(txt);
                const unit = isArabic ? "متبقي" : "left";
                const desiredText = targetStr + " " + unit;
                if (p.textContent !== desiredText) p.textContent = desiredText;
            });
        } catch(_) {}
        finally {
            _isReplacingCredits = false;
        }
    }

    // Real-time MutationObserver to catch messages with zero delay
    try {
        const domObserver = new MutationObserver((mutations) => {
            replaceBrandBadgesDOM();
        });
        domObserver.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    } catch(_) {}

    setInterval(() => {
        replaceBrandBadgesDOM();
        suppressAbuseAlertsDOM();
        if (license && license.credits !== undefined) {
            replaceLovableCreditsDOM(license.credits);
        }
    }, 500);

    // =========================================================================
    // 5. SERVER SWITCH OVERLAY ANIMATION & SESSION INJECTION
    // =========================================================================
    function showServerSwitchBanner(slotNum, titleText, subtitleText) {
        const existing = document.getElementById("ds-server-switch-overlay");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "ds-server-switch-overlay";
        overlay.style.cssText = "position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) scale(0.95); width: 320px; max-width: 90vw; background: rgba(12, 7, 26, 0.96); border: 1.5px solid #ba42ff; border-radius: 18px; padding: 18px 20px; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.95), 0 0 35px rgba(186, 66, 255, 0.35); backdrop-filter: blur(20px); z-index: 2147483647; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; text-align: center; opacity: 0; transition: all 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275); pointer-events: none; user-select: none;";

        const title = titleText || `SWITCHING TO SERVER`;
        const subtitle = subtitleText || `Logging in on VPS & Extracting Session...`;

        overlay.innerHTML = `
            <div style="position: relative; margin-bottom: 8px;">
                <img src="${LOGO_URI}" style="width: 48px; height: 48px; object-fit: contain; filter: drop-shadow(0 0 12px rgba(186,66,255,0.7));" alt="Logo" />
                <div style="position: absolute; bottom: -2px; right: -4px; background: #00d2d3; color: #0f0c20; font-size: 9.5px; font-weight: 900; padding: 1px 5px; border-radius: 4px;">PRO</div>
            </div>
            <div id="ds-switch-banner-title" style="font-size: 16px; font-weight: 900; letter-spacing: 0.3px; background: linear-gradient(135deg, #00d2d3, #ba42ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 2px;">
                ${title}
            </div>
            <div id="ds-switch-banner-sub" style="font-size: 11px; color: #8c8aa7; font-weight: 600; margin-bottom: 12px; line-height: 1.3;">
                ${subtitle}
            </div>
            <div style="width: 100%; height: 4px; background: #1b153b; border-radius: 2px; overflow: hidden; position: relative;">
                <div id="ds-switch-progress" style="width: 15%; height: 100%; background: linear-gradient(90deg, #00d2d3, #ba42ff); border-radius: 2px; transition: width 0.5s ease;"></div>
            </div>
        `;
        document.documentElement.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = "1";
            overlay.style.transform = "translate(-50%, -50%) scale(1)";
            const prog = document.getElementById("ds-switch-progress");
            if (prog) {
                prog.style.width = "80%";
                prog.style.transition = "width 25s cubic-bezier(0.1, 0.5, 0.2, 1)";
            }
        });
    }

    function updateSwitchBannerStatus(isSuccess, title, subtitle) {
        const overlay = document.getElementById("ds-server-switch-overlay");
        if (!overlay) return;

        const titleEl = document.getElementById("ds-switch-banner-title");
        const subEl = document.getElementById("ds-switch-banner-sub");
        const prog = document.getElementById("ds-switch-progress");

        if (titleEl) {
            titleEl.textContent = title;
            if (isSuccess) {
                titleEl.style.background = "linear-gradient(135deg, #00d2d3, #2ed573)";
            } else {
                titleEl.style.background = "linear-gradient(135deg, #ff4757, #ffa502)";
            }
            titleEl.style.webkitBackgroundClip = "text";
            titleEl.style.webkitTextFillColor = "transparent";
        }
        if (subEl) {
            subEl.textContent = subtitle;
            subEl.style.color = isSuccess ? "#00d2d3" : "#ff4757";
        }
        if (prog) {
            prog.style.transition = "width 0.4s ease";
            prog.style.width = isSuccess ? "100%" : "0%";
            if (isSuccess) {
                prog.style.background = "linear-gradient(90deg, #00d2d3, #2ed573)";
            } else {
                prog.style.background = "#ff4757";
            }
        }

        if (!isSuccess) {
            setTimeout(() => {
                overlay.style.opacity = "0";
                overlay.style.transform = "translate(-50%, -50%) scale(0.95)";
                setTimeout(() => overlay.remove(), 300);
            }, 4500);
        }
    }

    function executeSwitch(licKey, inviteUrl) {
        const switchBtn = document.getElementById("ds-switch-btn");
        const textEl = document.getElementById("ds-switch-btn-text");

        if (switchBtn) switchBtn.disabled = true;
        currentServerSlot = (currentServerSlot % 3) + 1;
        const msgText = inviteUrl ? "Joining project, accepting invitation & connecting..." : "Allocating dedicated Lovable account & authenticating...";
        showServerSwitchBanner(currentServerSlot, `CONNECTING TO SERVER`, msgText);

        if (textEl) textEl.textContent = `Connecting...`;

        window.postMessage({
            type: "LASTZONE_TRIGGER_SWITCH",
            slot: currentServerSlot,
            licenseKey: licKey,
            inviteUrl: inviteUrl || null
        }, "*");
    }

    function showSwitchConfirmModal(quote, presetInviteUrl, onConfirm) {
        const existing = document.getElementById("ds-confirm-modal-overlay");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "ds-confirm-modal-overlay";
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(5, 3, 15, 0.78); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 2147483647; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; opacity: 0; transition: opacity 0.22s ease;";

        const switchNum = (quote.switch_count || 0) + 1;
        const isFirst = (quote.switch_count === 0);
        const cost = quote.cost;
        const currentCredits = (quote.current_credits !== undefined) ? quote.current_credits : (license ? license.credits : 0);
        const balanceAfter = currentCredits - cost;

        const modal = document.createElement("div");
        modal.style.cssText = "width: 330px; max-width: 92vw; background: linear-gradient(165deg, #130e28 0%, #0c081c 100%); border: 1.5px solid #ba42ff; border-radius: 16px; padding: 16px 18px; box-shadow: 0 20px 60px rgba(0,0,0,0.88), 0 0 30px rgba(186,66,255,0.35); color: #ffffff; text-align: left; box-sizing: border-box; transform: scale(0.94); transition: transform 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275);";

        modal.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
                <div style="display: flex; align-items: center; gap: 9px;">
                    <div style="width: 34px; height: 34px; border-radius: 9px; background: rgba(186, 66, 255, 0.18); border: 1.5px solid #ba42ff; display: flex; align-items: center; justify-content: center; font-size: 16px;">⚡</div>
                    <div>
                        <div style="font-size: 14.5px; font-weight: 900; color: #ffffff; letter-spacing: 0.2px;">Switch Confirmation</div>
                        <div style="font-size: 9.5px; font-weight: 800; color: ${isFirst ? '#00d2d3' : '#a55eea'}; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 1px;">
                            ${isFirst ? '★ 1st Switch (10 Credits)' : `Switch #${switchNum} (15 Credits)`}
                        </div>
                    </div>
                </div>
                <button id="ds-modal-close-x" style="background: transparent; border: none; color: #8c8aa7; font-size: 15px; cursor: pointer; padding: 3px 6px; border-radius: 5px; transition: color 0.15s;">✕</button>
            </div>

            <div style="background: rgba(18, 12, 38, 0.92); border: 1px solid #2d1e57; border-radius: 12px; padding: 10px 12px; margin-bottom: 11px; display: flex; flex-direction: column; gap: 7px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px;">
                    <span style="color: #8c8aa7; font-weight: 600;">Current Balance</span>
                    <span style="color: #ffffff; font-weight: 800; font-family: monospace; font-size: 13px;">${currentCredits} credits</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px;">
                    <span style="color: #ff4757; font-weight: 600;">Switch Deduction</span>
                    <span style="color: #ff4757; font-weight: 900; font-family: monospace; font-size: 13.5px;">-${cost} credits</span>
                </div>
                <div style="height: 1px; background: #2d1e57; margin: 1px 0;"></div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11.5px;">
                    <span style="color: #00d2d3; font-weight: 700;">Remaining Balance</span>
                    <span style="color: #00d2d3; font-weight: 900; font-family: monospace; font-size: 13.5px;">${balanceAfter} credits</span>
                </div>
            </div>

            <!-- OPTIONAL INVITATION LINK INPUT -->
            <div style="margin-bottom: 12px; background: rgba(255,255,255,0.03); border: 1px solid #2d1e57; border-radius: 10px; padding: 9px 11px;">
                <label style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: 800; color: #00d2d3; margin-bottom: 5px;">
                    <span>🔗 Invite Link (Optional)</span>
                    <span style="font-size: 8.5px; color: #ba42ff; background: rgba(186,66,255,0.2); padding: 1px 5px; border-radius: 4px;">Auto-Accept</span>
                </label>
                <input type="text" id="ds-modal-invite-url" placeholder="https://lovable.dev/projects/...?... (Optional)" value="${escapeHtml(presetInviteUrl || savedInviteUrl || '')}" style="width: 100%; box-sizing: border-box; background: #0c081c; border: 1px solid #36296b; border-radius: 7px; padding: 7px 9px; color: #ffffff; font-size: 11px; outline: none;" />
                <div style="font-size: 9.5px; color: #8c8aa7; margin-top: 4px; line-height: 1.2;">
                    VPS will join project & auto-accept invitation.
                </div>
            </div>

            <div style="display: flex; gap: 8px;">
                <button id="ds-modal-cancel-btn" style="flex: 1; background: #1a1436; border: 1px solid #36296b; color: #a5a2c4; font-size: 11.5px; font-weight: 700; border-radius: 9px; padding: 9px 10px; cursor: pointer; transition: all 0.2s;">
                    Cancel
                </button>
                <button id="ds-modal-confirm-btn" style="flex: 1.6; background: linear-gradient(135deg, #00d2d3 0%, #ba42ff 100%); border: none; color: #ffffff; font-size: 12px; font-weight: 800; border-radius: 9px; padding: 9px 10px; cursor: pointer; box-shadow: 0 3px 14px rgba(186, 66, 255, 0.35); transition: transform 0.1s, opacity 0.2s;">
                    Confirm & Switch (-${cost})
                </button>
            </div>
        `;

        overlay.appendChild(modal);
        document.documentElement.appendChild(overlay);

        const inviteInput = overlay.querySelector("#ds-modal-invite-url");
        const initialInvite = presetInviteUrl || savedInviteUrl || "";
        if (inviteInput && initialInvite) {
            inviteInput.value = initialInvite;
        }

        requestAnimationFrame(() => {
            overlay.style.opacity = "1";
            modal.style.transform = "scale(1)";
        });

        const close = () => {
            overlay.style.opacity = "0";
            modal.style.transform = "scale(0.94)";
            setTimeout(() => overlay.remove(), 220);
        };

        const closeX = overlay.querySelector("#ds-modal-close-x");
        const cancelBtn = overlay.querySelector("#ds-modal-cancel-btn");
        const confirmBtn = overlay.querySelector("#ds-modal-confirm-btn");

        if (closeX) closeX.onclick = close;
        if (cancelBtn) cancelBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };

        if (confirmBtn) {
            confirmBtn.onclick = () => {
                const inviteUrl = (overlay.querySelector("#ds-modal-invite-url")?.value || "").trim();
                if (inviteUrl !== savedInviteUrl) {
                    savedInviteUrl = inviteUrl;
                    const dashInput = document.getElementById("ds-dashboard-invite-url");
                    if (dashInput) dashInput.value = inviteUrl;
                    try {
                        if (inviteUrl) {
                            window.localStorage.setItem("lastzone_saved_invite_url", inviteUrl);
                        } else {
                            window.localStorage.removeItem("lastzone_saved_invite_url");
                        }
                    } catch(_) {}
                    window.postMessage({ type: "LASTZONE_SAVE_INVITE_URL", inviteUrl: inviteUrl }, "*");
                }
                close();
                if (typeof onConfirm === "function") onConfirm(inviteUrl);
            };
        }
    }

    function showInsufficientCreditsModal(cost, currentCredits) {
        const existing = document.getElementById("ds-confirm-modal-overlay");
        if (existing) existing.remove();

        const overlay = document.createElement("div");
        overlay.id = "ds-confirm-modal-overlay";
        overlay.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(5, 3, 15, 0.8); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); z-index: 2147483647; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; opacity: 0; transition: opacity 0.22s ease;";

        const cur = (currentCredits !== undefined) ? currentCredits : 0;
        const shortfall = Math.max(0, cost - cur);

        const modal = document.createElement("div");
        modal.style.cssText = "width: 430px; max-width: 92vw; background: linear-gradient(165deg, #200d1c 0%, #0e0611 100%); border: 1.5px solid #ff4757; border-radius: 22px; padding: 26px 28px; box-shadow: 0 25px 70px rgba(0,0,0,0.88), 0 0 38px rgba(255,71,87,0.38); color: #ffffff; text-align: left; box-sizing: border-box; transform: scale(0.94); transition: transform 0.22s cubic-bezier(0.175, 0.885, 0.32, 1.275);";

        modal.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 18px;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="width: 42px; height: 42px; border-radius: 12px; background: rgba(255, 71, 87, 0.18); border: 1.5px solid #ff4757; display: flex; align-items: center; justify-content: center; font-size: 22px;">⚠️</div>
                    <div>
                        <div style="font-size: 18px; font-weight: 900; color: #ff4757; letter-spacing: 0.3px;">Insufficient Credits</div>
                        <div style="font-size: 11px; font-weight: 800; color: #ffa502; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px;">
                            Recharge Required to Switch
                        </div>
                    </div>
                </div>
                <button id="ds-modal-close-x" style="background: transparent; border: none; color: #8c8aa7; font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 6px;">✕</button>
            </div>

            <div style="background: rgba(30, 12, 22, 0.92); border: 1px solid #5a1928; border-radius: 16px; padding: 16px 18px; margin-bottom: 18px; display: flex; flex-direction: column; gap: 11px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                    <span style="color: #a5a2c4; font-weight: 600;">Your Current Balance</span>
                    <span style="color: #ff4757; font-weight: 900; font-family: monospace; font-size: 15px;">${cur} credits</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                    <span style="color: #a5a2c4; font-weight: 600;">Required for Switch</span>
                    <span style="color: #ffa502; font-weight: 900; font-family: monospace; font-size: 15px;">${cost} credits</span>
                </div>
                <div style="height: 1px; background: #5a1928; margin: 2px 0;"></div>
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
                    <span style="color: #ff6b81; font-weight: 700;">Credit Shortfall</span>
                    <span style="color: #ff6b81; font-weight: 900; font-family: monospace; font-size: 15px;">-${shortfall} credits needed</span>
                </div>
            </div>

            <div style="font-size: 12px; color: #b8a6b2; line-height: 1.5; margin-bottom: 22px;">
                You don't have enough credits on this license to perform this account switch. Please recharge your key to continue.
            </div>

            <div style="display: flex; gap: 10px;">
                <button id="ds-modal-cancel-btn" style="flex: 1; background: #231221; border: 1px solid #4a1c36; color: #a5a2c4; font-size: 13px; font-weight: 700; border-radius: 12px; padding: 12px 14px; cursor: pointer;">
                    Close
                </button>
                <a href="https://t.me/monir_i0_0i" target="_blank" style="flex: 1.8; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 7px; background: linear-gradient(135deg, #ff4757 0%, #ff6b81 100%); color: #ffffff; font-size: 13px; font-weight: 800; border-radius: 12px; padding: 12px 14px; cursor: pointer; box-shadow: 0 4px 18px rgba(255, 71, 87, 0.45);">
                    <span>💬</span>
                    <span>Recharge Now</span>
                </a>
            </div>
        `;

        overlay.appendChild(modal);
        document.documentElement.appendChild(overlay);

        requestAnimationFrame(() => {
            overlay.style.opacity = "1";
            modal.style.transform = "scale(1)";
        });

        const close = () => {
            overlay.style.opacity = "0";
            modal.style.transform = "scale(0.94)";
            setTimeout(() => overlay.remove(), 220);
        };

        const closeX = overlay.querySelector("#ds-modal-close-x");
        const cancelBtn = overlay.querySelector("#ds-modal-cancel-btn");

        if (closeX) closeX.onclick = close;
        if (cancelBtn) cancelBtn.onclick = close;
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
    }

    function handleQuoteResult(quote) {
        const switchBtn = document.getElementById("ds-switch-btn");
        const textEl = document.getElementById("ds-switch-btn-text");

        if (switchBtn) switchBtn.disabled = false;
        if (textEl) textEl.textContent = "Switch";

        try {
            console.log("%c[LAST ZONE] 📋 Switch Quote Result:", "color:#ba42ff; font-weight:bold;", quote);

            if (!quote || !quote.ok) {
                if (quote && (quote.deactivated || quote.error === "LICENSE_INACTIVE" || quote.error === "LICENSE_NOT_FOUND" || quote.error === "LICENSE_EXPIRED")) {
                    performLicenseLogout();
                    showActivateView();
                    const statusMsg = document.getElementById("ds-panel-status-msg");
                    if (statusMsg) {
                        statusMsg.style.display = "block";
                        statusMsg.style.color = "#ff4757";
                        statusMsg.textContent = "⛔ " + (quote.message || "License deactivated by administrator");
                    }
                    return;
                }
                alert((quote && quote.message) || "Failed to retrieve switch quote from server.");
                return;
            }

            // Sync live database policy and limits
            handlePolicyResult(quote);

            const licKey = quote.license_key || (license && license.license_key);

            if (!quote.can_switch) {
                if (quote.cooldown_remaining_seconds > 0) {
                    alert(`Switch cooldown is active. Please wait ${quote.cooldown_remaining_seconds} seconds before switching.`);
                    return;
                }
                if (quote.daily_switch_limit > 0 && quote.daily_switches_remaining <= 0) {
                    alert(`Daily switch limit reached (${quote.daily_switch_limit}/${quote.daily_switch_limit}). Please try again tomorrow.`);
                    return;
                }
                showInsufficientCreditsModal(quote.cost, quote.current_credits);
                return;
            }

            const dashInvite = document.getElementById("ds-dashboard-invite-url")?.value?.trim() || "";
            showSwitchConfirmModal(quote, dashInvite, (inviteUrl) => {
                executeSwitch(licKey, inviteUrl);
            });
        } catch(err) {
            console.error("[LAST ZONE] ❌ Error in handleQuoteResult:", err);
            alert("Error displaying switch modal: " + err.message);
        }
    }

    function handleSwitchResult(res) {
        const switchBtn = document.getElementById("ds-switch-btn");
        const textEl = document.getElementById("ds-switch-btn-text");

        if (switchBtn) switchBtn.__isConnecting = false;

        if (res && res.ok) {
            if (res.credits !== undefined && license) {
                license.credits = res.credits;
                updateWidgetUI();
                replaceLovableCreditsDOM(license.credits);
            }

            // Update policy stats and start cooldown timer immediately
            switchPolicy.lastSwitchAt = res.lastSwitchAt || new Date().toISOString();
            if (res.cooldownSeconds) switchPolicy.cooldownSeconds = res.cooldownSeconds;
            if (res.dailySwitchesCount) switchPolicy.dailyCount = res.dailySwitchesCount;
            if (res.dailySwitchLimit) switchPolicy.dailyLimit = res.dailySwitchLimit;
            if (res.dailySwitchesRemaining !== undefined) switchPolicy.dailyRemaining = res.dailySwitchesRemaining;
            try { window.localStorage.setItem("lastzone_switch_policy", JSON.stringify(switchPolicy)); } catch(_) {}
            updateSwitchPolicyUI();

            const isProjectJoined = res.invitationAccepted || (res.targetUrl && res.targetUrl.includes('/projects/'));
            const labelText = isProjectJoined
                ? `✓ Joined Project! Account: ${res.email}. Opening workspace...`
                : (res.email ? `Account: ${res.email} (${res.credits !== undefined ? res.credits + " credits left" : ""}). Reloading...` : "Session injected into browser. Reloading workspace...");
            
            updateSwitchBannerStatus(true, isProjectJoined ? "✓ PROJECT JOINED!" : "✓ SWITCH SUCCESSFUL!", labelText);

            // 1. Purge IndexedDB databases used by Firebase so old account isn't reloaded
            try {
                if (window.indexedDB) {
                    window.indexedDB.deleteDatabase("firebaseLocalStorageDb");
                    window.indexedDB.deleteDatabase("firebase-heartbeat-database");
                    console.log("[LAST ZONE] 🧹 IndexedDB Firebase caches deleted.");
                }
            } catch(idbErr) {
                console.warn("[LAST ZONE] IndexedDB purge notice:", idbErr);
            }

            // 2. Clear sessionStorage and purge old Lovable/Firebase cache keys from localStorage
            try {
                window.sessionStorage.clear();
                const toRemove = [];
                for (let i = 0; i < window.localStorage.length; i++) {
                    const k = window.localStorage.key(i);
                    // Keep extension state, remove any previous auth / lovable session data
                    if (k && !k.startsWith("lastzone_") && !k.startsWith("bruno_")) {
                        toRemove.push(k);
                    }
                }
                toRemove.forEach(k => window.localStorage.removeItem(k));
                console.log("[LAST ZONE] 🧹 SessionStorage and previous LocalStorage caches cleared.");
            } catch(stErr) {
                console.warn("[LAST ZONE] Storage cleanup notice:", stErr);
            }

            // 3. Inject fresh Firebase / Lovable workspace session
            if (res.session && res.session.localStorage) {
                try {
                    for (const [k, v] of Object.entries(res.session.localStorage)) {
                        window.localStorage.setItem(k, v);
                    }
                    console.log("[LAST ZONE] ✅ LocalStorage session tokens injected for " + (res.email || "account") + "!");
                } catch(e) {
                    console.warn("[LAST ZONE] LocalStorage injection error:", e);
                }
            }

            if (textEl) textEl.textContent = isProjectJoined ? "Opening..." : "Reloading...";

            // Reload page into the fresh account session or redirect directly into the joined project!
            setTimeout(() => {
                if (res.targetUrl && res.targetUrl.includes('/projects/')) {
                    console.log("[LAST ZONE] 🚀 Navigating directly to project workspace:", res.targetUrl);
                    window.location.href = res.targetUrl;
                } else {
                    window.location.href = "https://lovable.dev/projects";
                }
            }, 1200);
        } else {
            if (res && (res.deactivated || res.error === "LICENSE_INACTIVE" || res.error === "LICENSE_NOT_FOUND" || res.error === "LICENSE_EXPIRED")) {
                updateSwitchBannerStatus(false, "⛔ LICENSE DEACTIVATED", res.message || "License deactivated by administrator");
                setTimeout(() => {
                    const banner = document.getElementById("ds-switch-banner");
                    if (banner) banner.remove();
                    performLicenseLogout();
                    showActivateView();
                    const statusMsg = document.getElementById("ds-panel-status-msg");
                    if (statusMsg) {
                        statusMsg.style.display = "block";
                        statusMsg.style.color = "#ff4757";
                        statusMsg.textContent = "⛔ " + (res.message || "License deactivated by administrator");
                    }
                }, 1200);
                if (switchBtn) switchBtn.disabled = false;
                if (textEl) textEl.textContent = "Switch";
                return;
            }

            const errMsg = (res && res.message) || "Failed to switch account";
            let failureTitle = "✗ SWITCH FAILED";
            if (res && res.error === "COOLDOWN_ACTIVE") {
                failureTitle = "⏳ COOLDOWN ACTIVE";
            } else if (res && res.error === "DAILY_LIMIT_REACHED") {
                failureTitle = "⛔ DAILY LIMIT REACHED";
            } else if (res && res.error === "ALL_ACCOUNTS_IN_COOLDOWN") {
                failureTitle = "⏳ 24H ACCOUNT COOLDOWN";
            }
            updateSwitchBannerStatus(false, failureTitle, errMsg);
            if (res && res.error === "COOLDOWN_ACTIVE" && res.remaining_seconds) {
                switchPolicy.lastSwitchAt = new Date(Date.now() - ((switchPolicy.cooldownSeconds || 180) - res.remaining_seconds) * 1000).toISOString();
                try { window.localStorage.setItem("lastzone_switch_policy", JSON.stringify(switchPolicy)); } catch(_) {}
            }
            updateSwitchPolicyUI();

            if (res && (res.rechargeRequired || res.error === "INSUFFICIENT_CREDITS")) {
                showInsufficientCreditsModal(res.cost || 15, res.currentCredits || 0);
            }
        }
    }

    window.__dsShowServerSwitchBanner = showServerSwitchBanner;

    // =========================================================================
    // 6. ENLARGED FLOATING WIDGET & PANEL (Width: 440px | FAB: 72px)
    // =========================================================================
    function updateWidgetUI() {
        const userEl = document.getElementById("ds-user-title");
        if (userEl) userEl.textContent = (license && license.user_name) ? license.user_name : "No License";

        const planEl = document.getElementById("ds-plan-badge");
        if (planEl) planEl.textContent = (license && license.plan ? license.plan : "INACTIVE").toUpperCase() + " ⚡";

        const syncEl = document.getElementById("ds-sync-status");
        if (syncEl) {
            if (license && isSynced) {
                syncEl.innerHTML = `<span>🟢 License Active</span>`;
                syncEl.style.color = "#00d2d3";
            } else {
                syncEl.innerHTML = `<span>⚠️ License Inactive - Click to Activate</span>`;
                syncEl.style.color = "#ff4757";
            }
        }

        updateCountdown();
    }

    function updateCountdown() {
        const boxEl = document.getElementById("ds-countdown-box");
        const timeEl = document.getElementById("ds-expires-time");
        if (!timeEl) return;

        const exp = (license && license.expires_at) ? license.expires_at : null;

        // If Lifetime (no expiration date set), completely hide the expiration row
        if (!exp) {
            if (boxEl) boxEl.style.display = "none";
            return;
        }

        if (boxEl) boxEl.style.display = "block";

        const diff = new Date(exp).getTime() - Date.now();
        if (diff <= 0 || isNaN(diff)) {
            timeEl.textContent = "Expired";
            timeEl.style.color = "#ff4757";
            return;
        }

        const totalSec = Math.floor(diff / 1000);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        const secs = totalSec % 60;

        let displayStr = "";
        if (days > 0) {
            displayStr = `${days}d ${hours}h ${mins}m`;
        } else {
            displayStr = `${hours}h ${mins}m ${secs}s`;
        }
        timeEl.textContent = displayStr;
        timeEl.style.color = "#ffffff";

        const barEl = document.getElementById("ds-progress-line");
        if (barEl) {
            const pct = Math.min(100, Math.max(10, (totalSec / (30 * 86400)) * 100));
            barEl.style.width = pct + "%";
        }
    }

    function createFloatingWidget() {
        if (document.getElementById("ds-floating-widget")) return;
        const targetParent = document.body || document.documentElement;
        if (!targetParent) return;

        const widget = document.createElement("div");
        widget.id = "ds-floating-widget";
        widget.style.cssText = "position: fixed; bottom: 18px; right: 18px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; user-select: none;";

        // Compact Logo Image HTML
        const logoImgHtml = `<img src="${LOGO_URI}" style="width: 22px; height: 22px; object-fit: contain; border-radius: 6px;" alt="Logo" />`;
        const fabLogoImgHtml = `<img src="${LOGO_URI}" style="width: 28px; height: 28px; object-fit: contain; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));" alt="Logo" />`;

        widget.innerHTML = `
            <!-- COMPACT SLEEK FLOATING MODAL PANEL (Width 320px, Tight Sleek Padding 13px 15px) -->
            <div id="ds-panel" style="display: none; width: 320px; max-width: calc(100vw - 36px); background: #0c071a; border: 1.5px solid #281c47; border-radius: 18px; padding: 13px 15px; margin-bottom: 12px; box-shadow: 0 16px 50px rgba(0,0,0,0.92), 0 0 25px rgba(186, 66, 255, 0.2); flex-direction: column; gap: 10px; backdrop-filter: blur(25px); box-sizing: border-box;">
                
                <!-- HEADER (TITLE BAR) -->
                <div id="ds-panel-header" style="display:flex; justify-content:space-between; align-items:center; cursor:move; padding-bottom: 2px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        ${logoImgHtml}
                        <span style="color:#ffffff; font-size:14px; font-weight:800; letter-spacing:0.3px;">LAST ZONE</span>
                        <span style="background:rgba(186, 66, 255, 0.25); color:#f3a6ff; border:1px solid #ba42ff; font-size:10px; font-weight:800; padding:2px 8px; border-radius:999px; box-shadow:0 0 8px rgba(186, 66, 255, 0.35);">9.7.2</span>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <!-- LOGOUT LICENSE KEY BUTTON -->
                        <span id="ds-exit-btn" title="تسجيل الخروج من المفتاح وتغييره" style="color:#ff6b81; cursor:pointer; font-size:14px; display:flex; align-items:center; transition:color 0.2s; padding:3px; border-radius:6px;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                        </span>
                        <span id="ds-close-btn" title="Close" style="color:#8b81af; cursor:pointer; font-size:16px; font-weight:bold; display:flex; align-items:center; transition:color 0.2s;">✕</span>
                    </div>
                </div>

                <!-- ========================================================= -->
                <!-- VIEW 1: DASHBOARD VIEW (Shown when license is active)      -->
                <!-- ========================================================= -->
                <div id="ds-view-dashboard" style="display: flex; flex-direction: column; gap: 9px;">
                    
                    <!-- CARD: TRIAL & EXPIRATION (COMPACT) -->
                    <div style="background: rgba(20, 14, 38, 0.95); border: 1px solid #2d2050; border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 7px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span id="ds-user-title" style="color:#ffffff; font-size:13.5px; font-weight:800;">Trial</span>
                            <span id="ds-plan-badge" style="background:rgba(0, 210, 211, 0.15); color:#00d2d3; border:1px solid rgba(0, 210, 211, 0.4); font-size:10px; font-weight:800; padding:2px 8px; border-radius:999px;">PRO ⚡</span>
                        </div>
                        
                        <div id="ds-sync-status" style="font-size:11.5px; font-weight:600; color:#00d2d3; display:flex; align-items:center; gap:5px;">
                            <span>🟢 License Active</span>
                        </div>

                        <!-- INNER COUNTDOWN PROGRESS BOX -->
                        <div id="ds-countdown-box" style="background: #0e081e; border: 1px solid #231840; border-radius: 9px; padding: 7px 10px 11px; position: relative; overflow: hidden; display: none;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="color:#9e97bd; font-size:11px; font-weight:500; display:flex; align-items:center; gap:5px;">
                                    <span>🕒</span>
                                    <span>License expires in</span>
                                </span>
                                <span id="ds-expires-time" style="color:#ffffff; font-family:'Consolas',monospace; font-size:12.5px; font-weight:800;">--</span>
                            </div>
                            <!-- Neon Purple Progress Line -->
                            <div style="position:absolute; bottom:0; left:10px; right:10px; height:3px; background:#21173d; border-radius:2px;">
                                <div id="ds-progress-line" style="width:75%; height:100%; background:linear-gradient(90deg, #7158e2, #ba42ff); border-radius:2px; box-shadow:0 0 8px #ba42ff;"></div>
                            </div>
                        </div>
                    </div>

                    <!-- OPTIONAL: PROJECT INVITATION LINK INPUT WITH SAVE BUTTON -->
                    <div style="background: rgba(20, 14, 38, 0.95); border: 1px solid #2d2050; border-radius: 12px; padding: 9px 11px; display: flex; flex-direction: column; gap: 6px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <label style="color: #00d2d3; font-size: 10.5px; font-weight: 800; display: flex; align-items: center; gap: 5px;">
                                <span>🔗</span>
                                <span>Project Invite Link (Optional)</span>
                            </label>
                            <span style="font-size: 9px; color: #ba42ff; font-weight: 700; background: rgba(186, 66, 255, 0.15); border: 1px solid rgba(186, 66, 255, 0.3); padding: 1px 6px; border-radius: 5px;">Auto-Accept</span>
                        </div>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            <input type="text" id="ds-dashboard-invite-url" placeholder="https://lovable.dev/projects/...?... (Optional)" value="${escapeHtml(savedInviteUrl)}" style="flex: 1; min-width: 0; box-sizing: border-box; background: #0e081e; border: 1px solid #231840; border-radius: 8px; padding: 7px 9px; color: #ffffff; font-size: 11px; outline: none; transition: border-color 0.2s;" />
                            <button id="ds-save-invite-btn" title="حفظ الرابط لاستخدامه دائماً" style="background: #1e1338; border: 1px solid #ba42ff; color: #ba42ff; border-radius: 8px; padding: 6px 10px; font-size: 11px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px; white-space: nowrap; transition: all 0.2s; flex-shrink: 0;">
                                <span>💾</span>
                                <span id="ds-save-invite-text">Save</span>
                            </button>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div style="font-size: 9.5px; color: #8c8aa7; line-height: 1.2;">
                                Paste link & click <strong>Save</strong> to keep saved.
                            </div>
                            <span id="ds-invite-status-msg" style="font-size: 10px; font-weight: 700; color: #00d2d3; display: none;">✓ Saved!</span>
                        </div>
                    </div>

                    <!-- POLICY & LIMITS BOX (DAILY SWITCHES & COOLDOWN) -->
                    <div id="ds-policy-container" style="background: rgba(20, 14, 38, 0.95); border: 1px solid #2d2050; border-radius: 12px; padding: 9px 11px; display: flex; flex-direction: column; gap: 6px;">
                        <!-- ROW 1: DAILY SWITCHES REMAINING -->
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #9e97bd; font-size: 11px; font-weight: 600; display: flex; align-items: center; gap: 5px;">
                                <span>⚡</span>
                                <span>Daily Switches Left:</span>
                            </span>
                            <span id="ds-daily-switches-badge" style="background: rgba(0, 210, 211, 0.12); color: #00d2d3; border: 1px solid rgba(0, 210, 211, 0.35); font-size: 11px; font-weight: 800; font-family: 'Consolas', monospace; padding: 2px 8px; border-radius: 6px;">
                                -- / --
                            </span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 9.5px; color: #7f789e;">
                            <span>Resets daily every 24h</span>
                            <span id="ds-daily-limit-status" style="color: #a55eea; font-weight: 700;">Active</span>
                        </div>

                        <!-- ROW 2: COOLDOWN COUNTDOWN BOX (Visible during active cooldown) -->
                        <div id="ds-cooldown-card" style="display: none; background: rgba(255, 71, 87, 0.14); border: 1px solid rgba(255, 71, 87, 0.45); border-radius: 8px; padding: 6px 9px; align-items: center; justify-content: space-between; margin-top: 2px;">
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <span style="font-size: 13px;">⏳</span>
                                <div>
                                    <div style="font-size: 9.5px; font-weight: 800; color: #ffa502; text-transform: uppercase; letter-spacing: 0.3px;">Switch Cooldown</div>
                                    <div style="font-size: 9px; color: #e0d0d8;">Please wait before switching</div>
                                </div>
                            </div>
                            <span id="ds-cooldown-timer-text" style="color: #ff4757; font-family: 'Consolas', monospace; font-weight: 900; font-size: 13px; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 5px; border: 1px solid rgba(255,71,87,0.3);">
                                03:00
                            </span>
                        </div>
                    </div>

                    <!-- ACTION: SWITCH BUTTON (COMPACT) -->
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        <button id="ds-switch-btn" style="width:100%; background: linear-gradient(135deg, #7158e2, #ba42ff); border: 1px solid #ba42ff; color: #ffffff; border-radius: 10px; padding: 10px; font-size: 13.5px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 4px 15px rgba(186, 66, 255, 0.35); transition: transform 0.15s, opacity 0.15s;">
                            <span id="ds-switch-btn-icon" style="font-size: 15px;">🔄</span>
                            <span id="ds-switch-btn-text">Switch</span>
                        </button>
                    </div>

                    <!-- COMMUNITY SECTION (COMPACT) -->
                    <div style="background: rgba(14, 18, 38, 0.85); border: 1px solid #163654; border-radius: 12px; padding: 9px 11px; display:flex; flex-direction:column; gap:7px;">
                        <div style="color:#00d2d3; font-size:11px; font-weight:800; letter-spacing:0.3px; display:flex; align-items:center; gap:6px;">
                            <span style="font-size:12px;">✈️</span>
                            <span>LAST ZONE COMMUNITY</span>
                        </div>

                        <a href="https://t.me/+Dm8IppPh39s4YWIx" target="_blank" style="text-decoration:none; background:#10172e; border:1px solid #1c2e54; border-radius:8px; padding:8px 11px; display:flex; justify-content:space-between; align-items:center; color:#ffffff; font-size:11.5px; font-weight:600; cursor:pointer; transition:all 0.2s;">
                            <span style="display:flex; align-items:center; gap:7px;">
                                <span style="font-size:13px;">📢</span>
                                <span>Telegram Channel</span>
                            </span>
                            <span style="color:#8aa1cf; font-size:12px; font-weight:bold;">↗</span>
                        </a>

                        <a href="https://t.me/monir_i0_0i" target="_blank" style="text-decoration:none; background:#10172e; border:1px solid #1c2e54; border-radius:8px; padding:8px 11px; display:flex; justify-content:space-between; align-items:center; color:#ffffff; font-size:11.5px; font-weight:600; cursor:pointer; transition:all 0.2s;">
                            <span style="display:flex; align-items:center; gap:7px;">
                                <span style="font-size:13px;">💬</span>
                                <span>Technical Support</span>
                            </span>
                            <span style="color:#8aa1cf; font-size:12px; font-weight:bold;">↗</span>
                        </a>
                    </div>
                </div>

                <!-- ========================================================= -->
                <!-- VIEW 2: IN-PANEL ACTIVATION VIEW (COMPACT)                 -->
                <!-- ========================================================= -->
                <div id="ds-view-activate" style="display: none; flex-direction: column; align-items: center; gap: 10px;">
                    
                    <!-- CENTERED LOGO -->
                    <div style="margin: 2px 0 6px; display: flex; justify-content: center; align-items: center;">
                        <img src="${LOGO_URI}" style="width: 48px; height: 48px; object-fit: contain; filter: drop-shadow(0 3px 12px rgba(186, 66, 255, 0.4));" alt="LAST ZONE" />
                    </div>

                    <!-- TITLE & SUBTITLE -->
                    <div style="font-size: 16px; font-weight: 800; color: #ffffff; text-align: center; letter-spacing: 0.3px;">Activate License</div>
                    <div style="font-size: 11.5px; color: #837a9f; margin-bottom: 4px; text-align: center;">Enter your license key to continue.</div>

                    <!-- INPUT FORM -->
                    <div style="width: 100%;">
                        <input type="text" id="ds-panel-key-input" placeholder="LZ-XXXX-XXXX-XXXX" spellcheck="false" style="width: 100%; background: #110b23; border: 1.5px solid #a55eea; border-radius: 9px; padding: 10px 12px; color: #ffffff; font-size: 12px; font-family: 'Consolas', monospace; box-sizing: border-box; outline: none; letter-spacing: 0.8px; transition: border-color 0.2s, box-shadow 0.2s;" />
                    </div>

                    <button id="ds-panel-activate-btn" style="width: 100%; background: linear-gradient(90deg, #ba42ff 0%, #00d2d3 100%); color: #ffffff; border: none; border-radius: 9px; padding: 10px; font-size: 13px; font-weight: 800; cursor: pointer; box-shadow: 0 3px 15px rgba(0, 210, 211, 0.22); transition: opacity 0.2s, transform 0.1s;">Activate License</button>

                    <div id="ds-panel-status-msg" style="font-size: 11px; font-weight: 700; text-align: center; display: none;"></div>

                    <!-- LAST ZONE COMMUNITY -->
                    <div style="width: 100%; background: rgba(14, 18, 38, 0.85); border: 1px solid #163654; border-radius: 12px; padding: 9px 11px; box-sizing: border-box; display: flex; flex-direction: column; gap: 7px;">
                        <div style="color: #00d2d3; font-size: 11px; font-weight: 800; letter-spacing: 0.3px; display: flex; align-items: center; gap: 6px;">
                            <span style="font-size: 12px;">✈</span>
                            <span>LAST ZONE COMMUNITY</span>
                        </div>

                        <a href="https://t.me/+Dm8IppPh39s4YWIx" target="_blank" style="background: #10172e; border: 1px solid #1c2e54; border-radius: 8px; padding: 8px 11px; display: flex; justify-content: space-between; align-items: center; color: #ffffff; font-size: 11.5px; font-weight: 600; text-decoration: none; cursor: pointer; transition: background 0.2s;">
                            <div style="display: flex; align-items: center; gap: 7px;">
                                <span style="font-size: 13px;">📢</span>
                                <span>Telegram Channel</span>
                            </div>
                            <span style="color: #7b92c4; font-size: 12px; font-weight: bold;">↗</span>
                        </a>

                        <a href="https://t.me/monir_i0_0i" target="_blank" style="background: #10172e; border: 1px solid #1c2e54; border-radius: 8px; padding: 8px 11px; display: flex; justify-content: space-between; align-items: center; color: #ffffff; font-size: 11.5px; font-weight: 600; text-decoration: none; cursor: pointer; transition: background 0.2s;">
                            <div style="display: flex; align-items: center; gap: 7px;">
                                <span style="font-size: 13px;">💬</span>
                                <span>Technical Support</span>
                            </div>
                            <span style="color: #7b92c4; font-size: 12px; font-weight: bold;">↗</span>
                        </a>
                    </div>
                </div>

                <!-- FOOTER -->
                <div style="display:flex; justify-content:flex-end; padding-top:1px;">
                    <span style="background:#131b3e; color:#54a0ff; border:1px solid #1f3b8a; font-size:10px; font-weight:800; border-radius:5px; padding:2px 8px;">LAST ZONE - v9.7.2</span>
                </div>
            </div>

            <!-- COMPACT SLEEK FLOATING ACTION BUTTON (FAB: 48px x 48px) -->
            <div id="ds-fab" style="width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg, #7158e2, #ba42ff); box-shadow: 0 0 22px rgba(186, 66, 255, 0.65), 0 4px 15px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;">
                <div style="display:flex; align-items:center; justify-content:center;">
                    ${fabLogoImgHtml}
                </div>
            </div>
        `;

        targetParent.appendChild(widget);

        const fab = widget.querySelector("#ds-fab");
        const panel = widget.querySelector("#ds-panel");
        const header = widget.querySelector("#ds-panel-header");
        const exitBtn = widget.querySelector("#ds-exit-btn");
        const closeBtn = widget.querySelector("#ds-close-btn");
        const switchBtn = widget.querySelector("#ds-switch-btn");
        const activateBtn = widget.querySelector("#ds-panel-activate-btn");
        const keyInput = widget.querySelector("#ds-panel-key-input");

        fab.addEventListener("mouseenter", () => { fab.style.transform = "scale(1.08)"; });
        fab.addEventListener("mouseleave", () => { fab.style.transform = "scale(1)"; });

        let isDragging = false, hasDragged = false;
        let currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;

        function dragStart(e) {
            if (e.target.closest("button") || e.target.closest("a") || e.target.closest("input") || e.target.closest("span[id*='btn']")) return;
            initialX = e.clientX - xOffset;
            initialY = e.clientY - yOffset;
            isDragging = true;
            hasDragged = false;
        }

        function dragEnd(e) {
            initialX = currentX;
            initialY = currentY;
            isDragging = false;
            if (!hasDragged && (e.target === fab || (fab && fab.contains(e.target)))) {
                if (panel) {
                    const isOpen = (panel.style.display === "flex");
                    if (isOpen) {
                        panel.style.display = "none";
                    } else {
                        panel.style.display = "flex";
                        if (!license) {
                            showActivateView();
                        } else {
                            showDashboardView();
                        }
                    }
                }
            }
        }

        function drag(e) {
            if (isDragging) {
                e.preventDefault();
                hasDragged = true;
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX;
                yOffset = currentY;
                widget.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
            }
        }

        if (fab) fab.addEventListener("mousedown", dragStart);
        if (header) header.addEventListener("mousedown", dragStart);
        window.addEventListener("mouseup", dragEnd);
        window.addEventListener("mousemove", drag);

        if (closeBtn) closeBtn.addEventListener("click", () => { if (panel) panel.style.display = "none"; });
        
        // LOGOUT LICENSE KEY: SWITCH VIEW INSIDE THE PANEL
        if (exitBtn) {
            exitBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                performLicenseLogout();
            });
        }

        // ACTIVATION BUTTON INSIDE THE FLOATING PANEL
        if (activateBtn) {
            activateBtn.addEventListener("click", () => {
                const key = keyInput.value.trim();
                if (!key) return;
                activateBtn.disabled = true;
                activateBtn.textContent = "Activating...";
                const statusMsg = document.getElementById("ds-panel-status-msg");
                if (statusMsg) statusMsg.style.display = "none";

                window.postMessage({ type: "LASTZONE_VERIFY_KEY", key: key }, "*");
            });
        }

        if (keyInput) {
            keyInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    if (activateBtn) activateBtn.click();
                }
            });
        }

        // SAVE INVITE LINK BUTTON HANDLER
        const saveInviteBtn = widget.querySelector("#ds-save-invite-btn");
        const dashInviteInput = widget.querySelector("#ds-dashboard-invite-url");
        const inviteStatusMsg = widget.querySelector("#ds-invite-status-msg");
        const saveInviteText = widget.querySelector("#ds-save-invite-text");

        if (saveInviteBtn && dashInviteInput) {
            saveInviteBtn.addEventListener("click", () => {
                const url = (dashInviteInput.value || "").trim();
                savedInviteUrl = url;

                // 1. Save to localStorage
                try {
                    if (url) {
                        window.localStorage.setItem("lastzone_saved_invite_url", url);
                    } else {
                        window.localStorage.removeItem("lastzone_saved_invite_url");
                    }
                } catch(_) {}

                // 2. Sync to chrome.storage.local via content.js
                window.postMessage({
                    type: "LASTZONE_SAVE_INVITE_URL",
                    inviteUrl: url
                }, "*");

                // 3. Visual feedback
                saveInviteBtn.style.background = "rgba(0, 210, 211, 0.25)";
                saveInviteBtn.style.borderColor = "#00d2d3";
                saveInviteBtn.style.color = "#00d2d3";
                if (saveInviteText) saveInviteText.textContent = url ? "Saved!" : "Cleared!";
                if (inviteStatusMsg) {
                    inviteStatusMsg.textContent = url ? "✓ Link saved permanently" : "✓ Link removed";
                    inviteStatusMsg.style.display = "block";
                    inviteStatusMsg.style.color = url ? "#00d2d3" : "#ffa502";
                }

                setTimeout(() => {
                    saveInviteBtn.style.background = "#1e1338";
                    saveInviteBtn.style.borderColor = "#ba42ff";
                    saveInviteBtn.style.color = "#ba42ff";
                    if (saveInviteText) saveInviteText.textContent = "Save";
                    if (inviteStatusMsg) inviteStatusMsg.style.display = "none";
                }, 2200);
            });
        }

        // SWITCH BUTTON HANDLER
        if (switchBtn) {
            switchBtn.addEventListener("click", () => {
                if (switchBtn.disabled) return;

                const remCooldown = calculateCooldownRemainingSeconds();
                if (remCooldown > 0) {
                    const m = Math.floor(remCooldown / 60);
                    const s = remCooldown % 60;
                    alert(`Switch cooldown is active. Please wait ${m}m ${s}s before switching again.`);
                    return;
                }

                if (switchPolicy.dailyLimit > 0 && switchPolicy.dailyRemaining <= 0) {
                    alert(`Daily switch limit reached (${switchPolicy.dailyLimit}/${switchPolicy.dailyLimit}). Please try again tomorrow.`);
                    return;
                }

                const licKey = (license && license.license_key) || null;
                if (!licKey) {
                    showActivateView();
                    const statusMsg = document.getElementById("ds-panel-status-msg");
                    if (statusMsg) {
                        statusMsg.style.display = "block";
                        statusMsg.className = "status-msg status-error";
                        statusMsg.textContent = "Please activate your license first before switching.";
                    }
                    return;
                }

                switchBtn.disabled = true;
                switchBtn.__isConnecting = true;
                const textEl = document.getElementById("ds-switch-btn-text");
                if (textEl) textEl.textContent = "Checking...";

                // Fetch database-enforced quote before prompting confirmation
                window.postMessage({
                    type: "LASTZONE_GET_SWITCH_QUOTE",
                    licenseKey: licKey
                }, "*");
            });
        }

        setInterval(() => {
            updateCountdown();
            updateSwitchPolicyUI();
        }, 1000);
        setInterval(fetchPolicyLive, 30000);
        updateCountdown();
        updateWidgetUI();
        updateSwitchPolicyUI();
        fetchPolicyLive();
    }

    function ensureWidget() {
        try {
            if (!document.getElementById("ds-floating-widget") && (document.body || document.documentElement)) {
                createFloatingWidget();
            }
        } catch(_) {}
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", ensureWidget);
    } else {
        ensureWidget();
    }
    setInterval(ensureWidget, 2000);
})();
