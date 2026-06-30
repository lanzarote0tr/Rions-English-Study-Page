(function () {
    const core = window.EnglishStudy;
    const studyProgressStorageKey = "englishStudyProgress";
    const localTextPrefix = core.local.prefix;
    const studyPageContextKeys = {
        previousPage: "englishStudyPreviousPage",
        previousStudyTextPath: "englishStudyPreviousStudyTextPath",
    };
    const loadSettings = core.settings.load;
    const saveSettings = core.settings.save;
    const normalizeStudyMode = core.text.normalizeStudyMode;
    const applyTheme = core.theme.apply;
    const updateDarkModeToggle = core.theme.updateDarkModeToggle;
    const escapeHtml = core.html.escape;
    const parseLocalTextContent = core.local.parseTextContent;

    function loadStudyProgress() {
        try {
            return JSON.parse(sessionStorage.getItem(studyProgressStorageKey) || "{}");
        } catch (error) {
            return {};
        }
    }

    function saveStudyProgress(allProgress) {
        sessionStorage.setItem(studyProgressStorageKey, JSON.stringify(allProgress));
    }

    function loadPreviousStudyContext() {
        try {
            return {
                page: sessionStorage.getItem(studyPageContextKeys.previousPage) || "",
                textPath: sessionStorage.getItem(studyPageContextKeys.previousStudyTextPath) || "",
            };
        } catch (error) {
            return { page: "", textPath: "" };
        }
    }

    function isAlphaNum(char) {
        if (!char) {
            return false;
        }
        try {
            return /[\p{L}\p{N}]/u.test(char);
        } catch (error) {
            return /[A-Za-z0-9]/.test(char);
        }
    }

    function splitIntoSentences(text) {
        const boundaries = [];
        const quoteStack = [];
        const quotePairs = { '"': '"', "'": "'", "“": "”", "‘": "’" };
        const openQuotes = Object.keys(quotePairs);
        const punctRe = /[.!:?\u3002\uFF1F\uFF01]/;
        let start = 0;

        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            const lastQuote = quoteStack.length ? quoteStack[quoteStack.length - 1] : null;

            if (quotePairs[char] === char) {
                if (lastQuote === char) {
                    quoteStack.pop();
                } else if (char === "'" && isAlphaNum(text[index - 1]) && isAlphaNum(text[index + 1])) {
                    continue;
                } else {
                    quoteStack.push(char);
                }
            } else if (openQuotes.includes(char)) {
                quoteStack.push(char);
            } else if (lastQuote && quotePairs[lastQuote] === char) {
                quoteStack.pop();
            } else if (punctRe.test(char) && quoteStack.length === 0) {
                let end = index + 1;
                while (end < text.length && (punctRe.test(text[end]) || /\s/.test(text[end]))) {
                    end += 1;
                }
                boundaries.push({ start, end });
                start = end;
                index = end - 1;
            }
        }

        if (start < text.length) {
            boundaries.push({ start, end: text.length });
        }

        return {
            boundaries,
            sentences: boundaries.map((boundary) => text.slice(boundary.start, boundary.end).trim()).filter(Boolean),
        };
    }

    function getEnglishLineBoundaries(linePairs, englishText) {
        if (!Array.isArray(linePairs) || !linePairs.length) {
            return splitIntoSentences(englishText).boundaries;
        }

        const boundaries = [];
        let cursor = 0;
        linePairs.forEach((pair) => {
            const englishLine = (pair.english || "").replace(/\*\*/g, "");
            const end = cursor + englishLine.length;
            boundaries.push({ start: cursor, end });
            cursor = end;
            if (englishText[cursor] === "\n") {
                cursor += 1;
            }
        });
        return boundaries;
    }

    function getTranslationLines(linePairs, koreanText) {
        if (Array.isArray(linePairs) && linePairs.length) {
            return linePairs.map((pair) => pair.korean || "");
        }
        return splitIntoSentences(koreanText).sentences;
    }

    function resolveLocalTextPayload(text) {
        if (!text.text_path || !text.text_path.startsWith(localTextPrefix)) {
            return text;
        }

        const localPath = text.text_path.slice(localTextPrefix.length);
        const localText = window.EnglishStudyLocal && window.EnglishStudyLocal.getText
            ? window.EnglishStudyLocal.getText(localPath)
            : null;
        if (!localText) {
            return {
                ...text,
                title: "개인 텍스트 없음",
                english_content: "이 브라우저에서 저장된 개인 텍스트를 찾을 수 없습니다.",
                korean_content: "",
                line_pairs: [],
                parent_dir_path: localPath.split("/").slice(0, -1).join("/"),
            };
        }

        const parsed = parseLocalTextContent(localText.content);
        return {
            ...text,
            title: localText.name,
            text_path: `${localTextPrefix}${localText.path}`,
            english_content: parsed.english_content,
            korean_content: parsed.korean_content,
            line_pairs: parsed.line_pairs,
            parent_dir_path: localText.parent_path || "",
        };
    }

    function findSentenceIndex(boundaries, cursorIndex) {
        const found = boundaries.findIndex((boundary) => cursorIndex < boundary.end);
        if (found >= 0) {
            return found;
        }
        return boundaries.length ? boundaries.length - 1 : -1;
    }

    function visitHref(href) {
        if (!href) {
            return;
        }
        if (window.EnglishStudyNavigation && typeof window.EnglishStudyNavigation.visit === "function") {
            window.EnglishStudyNavigation.visit(href);
            return;
        }
        window.location.href = href;
    }

    window.EnglishStudyPages = window.EnglishStudyPages || {};
    window.EnglishStudyPages.study = {
        init() {
            if (document.body.dataset.page !== "study") {
                return () => {};
            }

            const studyDataEl = document.getElementById("study-data");
            if (!studyDataEl) {
                return () => {};
            }

            const studyData = JSON.parse(studyDataEl.textContent);
            const resolvedText = resolveLocalTextPayload(studyData.text);
            const state = {
                text: resolvedText,
                mode: normalizeStudyMode(studyData.mode),
                settings: loadSettings(),
                koreanVisible: false,
                progress: loadStudyProgress(),
            };
            const previousContext = loadPreviousStudyContext();

            let cleanup = () => {};
            let persistCurrentMode = () => {};
            let completionNoticeTimer = null;
            let completionConfetti = null;
            let completionNoticeKeyHandler = null;
            const completionMessages = {
                practice: "글쓰기 완료!",
                fill: "단어 채우기 완료!",
                line: "한줄해석 완료!",
            };

            const studyTitle = document.querySelector(".study-title");
            if (studyTitle) {
                studyTitle.textContent = state.text.title;
            }
            document.title = `${state.text.title} - Rion's English Study Page`;

            if (previousContext.page !== "study" || previousContext.textPath !== state.text.text_path) {
                delete state.progress[state.text.text_path];
                saveStudyProgress(state.progress);
            }

            function getTextProgress() {
                return state.progress[state.text.text_path] || {};
            }

            function saveTextProgress(mode, payload) {
                const textProgress = getTextProgress();
                state.progress[state.text.text_path] = {
                    ...textProgress,
                    [mode]: payload,
                };
                saveStudyProgress(state.progress);
            }

            function markCompletionNoticeShown(mode) {
                const textProgress = getTextProgress();
                const completionNotices = {
                    ...(textProgress.completionNotices || {}),
                };
                if (completionNotices[mode]) {
                    return false;
                }
                completionNotices[mode] = true;
                state.progress[state.text.text_path] = {
                    ...textProgress,
                    completionNotices,
                };
                saveStudyProgress(state.progress);
                return true;
            }

            function hideCompletionPopup() {
                const notice = document.getElementById("completionNotice");
                if (notice) {
                    notice.classList.remove("visible");
                }
                if (completionNoticeTimer !== null) {
                    window.clearTimeout(completionNoticeTimer);
                    completionNoticeTimer = null;
                }
                if (completionNoticeKeyHandler) {
                    document.removeEventListener("keydown", completionNoticeKeyHandler, true);
                    completionNoticeKeyHandler = null;
                }
                if (completionConfetti) {
                    completionConfetti.destroy();
                }
            }

            function getCompletionConfetti() {
                if (completionConfetti) {
                    return completionConfetti;
                }

                const canvas = document.createElement("canvas");
                const context = canvas.getContext("2d");
                const particles = [];
                const colors = ["#ff5f8f", "#ffb54b", "#ffe77b", "#70e2c7", "#7bb9ff", "#b68cff", "#ffffff"];
                let dpr = Math.min(window.devicePixelRatio || 1, 2);
                let width = 0;
                let height = 0;
                let last = performance.now();
                let frameId = null;

                canvas.className = "completion-confetti-canvas";
                canvas.setAttribute("aria-hidden", "true");
                document.body.appendChild(canvas);

                function resize() {
                    dpr = Math.min(window.devicePixelRatio || 1, 2);
                    width = window.innerWidth;
                    height = window.innerHeight;
                    canvas.width = Math.round(width * dpr);
                    canvas.height = Math.round(height * dpr);
                    canvas.style.width = `${width}px`;
                    canvas.style.height = `${height}px`;
                    context.setTransform(dpr, 0, 0, dpr, 0, 0);
                }

                class Paper {
                    constructor(x, y, options = {}) {
                        const angle = options.angle ?? (Math.random() * Math.PI * 2);
                        const speed = options.speed ?? (3.8 + Math.random() * 7.2);
                        this.x = x;
                        this.y = y;
                        this.vx = Math.cos(angle) * speed + (Math.random() - 0.5) * 1.7;
                        this.vy = Math.sin(angle) * speed - (1.3 + Math.random() * 1.4);
                        this.w = 5 + Math.random() * 7;
                        this.h = 8 + Math.random() * 11;
                        this.rotation = Math.random() * Math.PI;
                        this.spin = (Math.random() - 0.5) * 0.55;
                        this.wobble = Math.random() * Math.PI * 2;
                        this.wobbleSpeed = 0.08 + Math.random() * 0.15;
                        this.color = colors[(Math.random() * colors.length) | 0];
                        this.life = 0;
                        this.maxLife = 165 + Math.random() * 105;
                        this.alpha = 1;
                    }

                    update(dt) {
                        const time = dt / 16.67;
                        this.life += time;
                        this.wobble += this.wobbleSpeed * time;
                        this.vx += Math.sin(this.wobble) * 0.026 * time;
                        this.vx *= Math.pow(0.992, time);
                        this.vy += 0.165 * time;
                        this.vy *= Math.pow(0.998, time);
                        this.x += this.vx * time;
                        this.y += this.vy * time;
                        this.rotation += this.spin * time;

                        if (this.y + this.h > height - 2) {
                            this.y = height - 2 - this.h;
                            this.vy *= -0.38;
                            this.vx *= 0.72;
                            this.spin *= 0.82;
                        }
                        if (this.x < -40 || this.x > width + 40 || this.life > this.maxLife) {
                            return false;
                        }
                        this.alpha = Math.max(0, 1 - Math.max(0, this.life - this.maxLife * 0.72) / (this.maxLife * 0.28));
                        return true;
                    }

                    draw() {
                        context.save();
                        context.translate(this.x, this.y);
                        context.rotate(this.rotation + Math.sin(this.wobble) * 0.38);
                        context.globalAlpha = this.alpha;
                        context.fillStyle = this.color;
                        context.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
                        context.globalAlpha = this.alpha * 0.28;
                        context.fillStyle = "#ffffff";
                        context.fillRect(-this.w / 2, -this.h / 2, this.w, Math.max(1.2, this.h * 0.16));
                        context.restore();
                    }
                }

                function emitAround(element, amount = 190) {
                    if (!element) {
                        return;
                    }

                    const rect = element.getBoundingClientRect();
                    const centerX = rect.left + rect.width / 2;
                    const centerY = rect.top + rect.height / 2;
                    const perimeter = 2 * (rect.width + rect.height);

                    for (let index = 0; index < amount; index += 1) {
                        const edge = Math.random() * perimeter;
                        let x;
                        let y;
                        let normalX;
                        let normalY;

                        if (edge < rect.width) {
                            x = rect.left + edge;
                            y = rect.top;
                            normalX = 0;
                            normalY = -1;
                        } else if (edge < rect.width + rect.height) {
                            x = rect.right;
                            y = rect.top + (edge - rect.width);
                            normalX = 1;
                            normalY = 0;
                        } else if (edge < 2 * rect.width + rect.height) {
                            x = rect.right - (edge - rect.width - rect.height);
                            y = rect.bottom;
                            normalX = 0;
                            normalY = 1;
                        } else {
                            x = rect.left;
                            y = rect.bottom - (edge - 2 * rect.width - rect.height);
                            normalX = -1;
                            normalY = 0;
                        }

                        const dx = x - centerX;
                        const dy = y - centerY;
                        const length = Math.hypot(dx, dy) || 1;
                        const outwardX = dx / length;
                        const outwardY = dy / length;
                        const direction = Math.atan2(outwardY * 0.65 + normalY * 0.8, outwardX * 0.65 + normalX * 0.8);
                        particles.push(new Paper(x + normalX * 6, y + normalY * 6, {
                            angle: direction + (Math.random() - 0.5) * 1.3,
                            speed: 4.2 + Math.random() * 7.3,
                        }));
                    }

                    const centerAmount = Math.floor(amount * 0.18);
                    for (let index = 0; index < centerAmount; index += 1) {
                        particles.push(new Paper(centerX, centerY, {
                            angle: (Math.PI * 2 * index) / centerAmount + (Math.random() - 0.5) * 0.22,
                            speed: 2.8 + Math.random() * 5.2,
                        }));
                    }
                }

                function frame(now) {
                    const dt = Math.min(34, now - last);
                    last = now;
                    context.clearRect(0, 0, width, height);

                    for (let index = particles.length - 1; index >= 0; index -= 1) {
                        if (!particles[index].update(dt)) {
                            particles.splice(index, 1);
                        } else {
                            particles[index].draw();
                        }
                    }

                    frameId = particles.length ? requestAnimationFrame(frame) : null;
                }

                function burst(element, amount = 190) {
                    emitAround(element, amount);
                    if (!frameId && particles.length) {
                        last = performance.now();
                        frameId = requestAnimationFrame(frame);
                    }
                }

                function destroy() {
                    if (frameId) {
                        cancelAnimationFrame(frameId);
                    }
                    window.removeEventListener("resize", resize);
                    canvas.remove();
                    particles.length = 0;
                    completionConfetti = null;
                }

                window.addEventListener("resize", resize, { passive: true });
                resize();
                completionConfetti = { burst, destroy };
                return completionConfetti;
            }

            function showCompletionPopup(message) {
                const pageRoot = document.getElementById("page-root");
                if (!pageRoot) {
                    return;
                }

                let notice = document.getElementById("completionNotice");
                if (!notice) {
                    notice = document.createElement("div");
                    notice.id = "completionNotice";
                    notice.className = "completion-notice";
                    notice.setAttribute("role", "status");
                    notice.setAttribute("aria-live", "polite");
                    pageRoot.appendChild(notice);
                }

                notice.innerHTML = "";
                const image = document.createElement("img");
                image.className = "completion-notice-image";
                image.src = "/static/img/clear.gif";
                image.alt = "";
                image.setAttribute("aria-hidden", "true");

                const text = document.createElement("span");
                text.className = "completion-notice-text";
                text.textContent = message;

                const closeButton = document.createElement("button");
                closeButton.type = "button";
                closeButton.className = "completion-notice-close";
                closeButton.textContent = "끄기(Enter)";
                closeButton.addEventListener("click", hideCompletionPopup, { once: true });

                notice.append(image, text, closeButton);
                if (completionNoticeTimer !== null) {
                    window.clearTimeout(completionNoticeTimer);
                    completionNoticeTimer = null;
                }
                if (completionNoticeKeyHandler) {
                    document.removeEventListener("keydown", completionNoticeKeyHandler, true);
                }
                completionNoticeKeyHandler = (event) => {
                    if (!notice.classList.contains("visible")) {
                        return;
                    }
                    if (event.key !== "Enter") {
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    hideCompletionPopup();
                };

                notice.classList.remove("visible");
                void notice.offsetHeight;
                notice.classList.add("visible");
                document.addEventListener("keydown", completionNoticeKeyHandler, true);
                requestAnimationFrame(() => {
                    getCompletionConfetti().burst(notice, 280);
                });
                completionNoticeTimer = window.setTimeout(() => {
                    hideCompletionPopup();
                }, 4000);
            }

            function showModeCompletionNotice(mode) {
                const message = completionMessages[mode];
                if (!message || !markCompletionNoticeShown(mode)) {
                    return;
                }
                showCompletionPopup(message);
            }

            function applyKoreanVisibility(hasKorean) {
                document.body.classList.toggle("korean-visible", Boolean(hasKorean && state.koreanVisible));
            }

            function getLinkHref(id) {
                const link = document.getElementById(id);
                return link ? link.href : null;
            }

            function navigateTo(id) {
                const link = document.getElementById(id);
                if (link && typeof link.click === "function") {
                    link.click();
                    return;
                }
                visitHref(getLinkHref(id));
            }

            function isModeTransitioning() {
                return Boolean(window.EnglishStudyModeTransitioning);
            }

            const studyModeButtons = [...document.querySelectorAll(".study-mode-button")];

            function navigateStudyMode(offset) {
                const modes = ["practice", "fill", "line"];
                const currentIndex = modes.indexOf(state.mode);
                if (currentIndex < 0) {
                    return;
                }
                const nextIndex = Math.min(Math.max(currentIndex + offset, 0), modes.length - 1);
                if (nextIndex === currentIndex) {
                    return;
                }
                const target = studyModeButtons[nextIndex];
                if (target && typeof target.click === "function") {
                    target.click();
                }
            }

            function handleCommonStudyShortcut(event) {
                if (!event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
                    return false;
                }
                const key = event.key.toLowerCase();
                if (key === "f") {
                    event.preventDefault();
                    handleFullscreenToggle();
                    return true;
                }
                if (event.key === "<" || event.code === "Comma") {
                    event.preventDefault();
                    navigateStudyMode(-1);
                    return true;
                }
                if (event.key === ">" || event.code === "Period") {
                    event.preventDefault();
                    navigateStudyMode(1);
                    return true;
                }
                return false;
            }

            const fullscreenToggle = document.getElementById("fullscreenToggle");
            let studyFullscreenActive = false;

            function isStudyFullscreen() {
                return studyFullscreenActive;
            }

            function updateFullscreenToggle() {
                if (!fullscreenToggle) {
                    return;
                }
                const active = isStudyFullscreen();
                document.body.classList.toggle("study-fullscreen-active", active);
                fullscreenToggle.setAttribute("aria-pressed", String(active));
                fullscreenToggle.title = active ? "전체화면 종료" : "전체화면";
            }

            function handleFullscreenToggle() {
                if (!fullscreenToggle) {
                    return;
                }
                studyFullscreenActive = !studyFullscreenActive;
                updateFullscreenToggle();
            }

            if (fullscreenToggle) {
                fullscreenToggle.addEventListener("click", handleFullscreenToggle);
                updateFullscreenToggle();
            }

            function initializePracticeMode() {
                const englishText = (state.text.english_content || "").replace(/\*\*/g, "");
                const koreanText = state.text.korean_content || "";
                const linePairs = state.text.line_pairs || [];
                const textDisplay = document.getElementById("text-display");
                const switchContainer = document.getElementById("switchContainer");
                const statusText = document.getElementById("statusText");
                const koreanWidget = document.getElementById("korean-widget");
                const cursor = document.getElementById("cursor");

                switchContainer.innerHTML = `
                    ${koreanText ? '<div class="switch-group"><label class="switch"><input type="checkbox" id="toggle-korean"><span class="slider"></span></label><label for="toggle-korean" class="switch-label">한글 (Shift+K)</label></div>' : ''}
                    <div class="switch-group">
                        <label class="switch"><input type="checkbox" id="toggle-visibility"><span class="slider"></span></label>
                        <label for="toggle-visibility" class="switch-label">미리보기 (Shift+O)</label>
                    </div>
                    <div class="switch-group">
                        <label class="switch"><input type="checkbox" id="toggle-partial-preview"><span class="slider"></span></label>
                        <label for="toggle-partial-preview" class="switch-label">일부 미리보기 (Shift+H)</label>
                    </div>
                    <div class="switch-group">
                        <label class="switch"><input type="checkbox" id="darkModeToggle"><span class="slider"></span></label>
                        <label for="darkModeToggle" class="switch-label">다크모드</label>
                    </div>
                `;
                updateDarkModeToggle(state.settings);

                const visibilityToggle = document.getElementById("toggle-visibility");
                const partialPreviewToggle = document.getElementById("toggle-partial-preview");
                const darkModeToggle = document.getElementById("darkModeToggle");
                const koreanToggle = document.getElementById("toggle-korean");

                visibilityToggle.checked = state.settings.practiceReveal;
                partialPreviewToggle.checked = state.settings.practiceWordHint;
                document.body.classList.toggle("hide-upcoming", !state.settings.practiceReveal);

                const punctuationToSkip = '!"#$%&\\\'()*+,-./:;<=>?@[\\]^_`{|}~\n\t';
                const characters = [];
                const koreanSentences = [];
                const englishBoundaries = getEnglishLineBoundaries(linePairs, englishText);
                const practiceProgress = getTextProgress().practice || {};
                const typedCharacters = Array.isArray(practiceProgress.typedCharacters)
                    ? [...practiceProgress.typedCharacters]
                    : [];
                let currentIndex = 0;
                let cursorFrame = null;
                let resizeObserver = null;
                let activeCharacter = null;
                let activeKoreanSentenceIndex = -1;
                const previewedCharacters = new Set();

                cursor.style.opacity = "0";
                cursor.style.transform = "translate3d(0, 0, 0)";

                const textFragment = document.createDocumentFragment();
                englishText.split("").forEach((char) => {
                    const span = document.createElement("span");
                    span.textContent = char;
                    textFragment.appendChild(span);
                    characters.push(span);
                });
                textDisplay.appendChild(textFragment);
                textDisplay.appendChild(cursor);

                if (koreanText) {
                    getTranslationLines(linePairs, koreanText).forEach((sentence) => {
                        const span = document.createElement("span");
                        span.innerText = sentence;
                        koreanWidget.appendChild(span);
                        koreanSentences.push(span);
                    });
                }

                function updateStatus() {
                    statusText.textContent = "";
                }

                function updateKoreanToggle() {
                    if (!koreanToggle) {
                        return;
                    }
                    koreanToggle.classList.toggle("active", Boolean(state.koreanVisible));
                    koreanToggle.checked = Boolean(state.koreanVisible);
                    koreanToggle.setAttribute("aria-pressed", String(Boolean(state.koreanVisible)));
                }

                function toggleKoreanVisibility() {
                    if (!koreanText) {
                        return;
                    }
                    state.koreanVisible = !state.koreanVisible;
                    applyKoreanVisibility(koreanText);
                    updateKoreanToggle();
                    scheduleCursorUpdate();
                    persistPracticeProgress();
                }

                function updateKoreanHighlight() {
                    if (!koreanSentences.length || !englishBoundaries.length) {
                        return;
                    }
                    const sentenceIndex = findSentenceIndex(englishBoundaries, currentIndex);
                    if (sentenceIndex < 0) {
                        return;
                    }
                    if (activeKoreanSentenceIndex !== sentenceIndex) {
                        if (koreanSentences[activeKoreanSentenceIndex]) {
                            koreanSentences[activeKoreanSentenceIndex].classList.remove("highlight");
                        }
                        if (koreanSentences[sentenceIndex]) {
                            koreanSentences[sentenceIndex].classList.add("highlight");
                        }
                        activeKoreanSentenceIndex = sentenceIndex;
                    }
                    if (document.body.classList.contains("korean-visible") && koreanSentences[sentenceIndex]) {
                        koreanSentences[sentenceIndex].scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                }

                function isUntypableCharacter(char) {
                    if (!char) {
                        return false;
                    }
                    const charCode = char.charCodeAt(0);
                    return charCode > 126 || (charCode < 32 && charCode !== 9 && charCode !== 10);
                }

                function isSkippedCharacter(index) {
                    if (index < 0 || index >= englishText.length) {
                        return false;
                    }
                    const char = englishText[index];
                    return isUntypableCharacter(char) || punctuationToSkip.includes(char);
                }

                function markCharacterCorrect(index) {
                    if (!characters[index]) {
                        return;
                    }
                    characters[index].textContent = englishText[index];
                    characters[index].classList.remove("incorrect");
                    characters[index].classList.add("correct");
                }

                function skipAutoCharacters() {
                    while (currentIndex < characters.length && isSkippedCharacter(currentIndex)) {
                        markCharacterCorrect(currentIndex);
                        typedCharacters[currentIndex] = null;
                        currentIndex += 1;
                    }
                }

                function clearPartialPreview() {
                    previewedCharacters.forEach((span) => span.classList.remove("partial-preview-active"));
                    previewedCharacters.clear();
                }

                function addPartialPreview(index) {
                    const span = characters[index];
                    if (!span) {
                        return;
                    }
                    span.classList.add("partial-preview-active");
                    previewedCharacters.add(span);
                }

                function updatePartialPreview() {
                    clearPartialPreview();
                    if (!state.settings.practiceWordHint) {
                        return;
                    }
                    addPartialPreview(currentIndex);
                    let start = currentIndex;
                    while (start < englishText.length && /\s/.test(englishText[start])) {
                        start += 1;
                    }
                    if (start >= englishText.length) {
                        return;
                    }
                    let end = start;
                    while (end < englishText.length && !/\s/.test(englishText[end])) {
                        end += 1;
                    }
                    for (let index = start; index < end; index += 1) {
                        addPartialPreview(index);
                    }
                }

                function getCharacterRect(span) {
                    const rects = span.getClientRects();
                    if (rects.length) {
                        return rects[rects.length - 1];
                    }
                    return span.getBoundingClientRect();
                }

                function getCursorTarget() {
                    if (characters[currentIndex]) {
                        const span = characters[currentIndex];
                        const rect = getCharacterRect(span);
                        const containerRect = textDisplay.getBoundingClientRect();
                        const height = rect.height || Number.parseFloat(getComputedStyle(textDisplay).lineHeight) || 24;
                        return {
                            left: rect.left - containerRect.left + textDisplay.scrollLeft,
                            top: rect.top - containerRect.top + textDisplay.scrollTop,
                            height,
                        };
                    }

                    if (characters.length) {
                        const span = characters[characters.length - 1];
                        const rect = getCharacterRect(span);
                        const containerRect = textDisplay.getBoundingClientRect();
                        const height = rect.height || Number.parseFloat(getComputedStyle(textDisplay).lineHeight) || 24;
                        return {
                            left: rect.right - containerRect.left + textDisplay.scrollLeft,
                            top: rect.top - containerRect.top + textDisplay.scrollTop,
                            height,
                        };
                    }

                    return null;
                }

                function updateCursor(show) {
                    if (!show) {
                        cursor.style.opacity = "0";
                        return;
                    }

                    const nextActiveCharacter = characters[currentIndex] || null;
                    if (activeCharacter !== nextActiveCharacter) {
                        if (activeCharacter) {
                            activeCharacter.classList.remove("current");
                        }
                        if (nextActiveCharacter) {
                            nextActiveCharacter.classList.add("current");
                        }
                        activeCharacter = nextActiveCharacter;
                    }

                    const target = getCursorTarget();
                    if (!target) {
                        cursor.style.opacity = "0";
                        return;
                    }

                    const cursorHeight = Math.max(12, target.height * 0.8);
                    const cursorTop = target.top + (target.height - cursorHeight) / 2;
                    const cursorLeft = target.left;
                    cursor.style.height = `${cursorHeight}px`;
                    cursor.style.transform = `translate3d(${cursorLeft}px, ${cursorTop}px, 0)`;
                    cursor.style.opacity = "1";
                    updatePartialPreview();
                }

                function scheduleCursorUpdate() {
                    if (cursorFrame !== null) {
                        return;
                    }
                    cursorFrame = requestAnimationFrame(() => {
                        cursorFrame = null;
                        updateCursor(true);
                    });
                }

                function persistPracticeProgress() {
                    saveTextProgress("practice", {
                        currentIndex,
                        typedCharacters,
                        koreanVisible: state.koreanVisible,
                    });
                }

                function refreshPracticeView() {
                    document.body.classList.toggle("hide-upcoming", !state.settings.practiceReveal);
                    updateStatus();
                    updateKoreanHighlight();
                    updateCursor(true);
                    persistPracticeProgress();
                }

                function checkPracticeCompletion() {
                    if (characters.length > 0 && currentIndex >= characters.length) {
                        showModeCompletionNotice("practice");
                    }
                }

                function syncPracticePreviewToggles() {
                    visibilityToggle.checked = state.settings.practiceReveal;
                    partialPreviewToggle.checked = state.settings.practiceWordHint;
                    document.body.classList.toggle("hide-upcoming", !state.settings.practiceReveal);
                }

                function setPracticePreviewSettings(nextSettings, revealWhenHintDisabled = false) {
                    const revealProvided = Object.prototype.hasOwnProperty.call(nextSettings, "practiceReveal");
                    const wordHintProvided = Object.prototype.hasOwnProperty.call(nextSettings, "practiceWordHint");
                    state.settings.practiceReveal = revealProvided
                        ? Boolean(nextSettings.practiceReveal)
                        : Boolean(state.settings.practiceReveal);
                    state.settings.practiceWordHint = wordHintProvided
                        ? Boolean(nextSettings.practiceWordHint)
                        : Boolean(state.settings.practiceWordHint);

                    if (wordHintProvided && state.settings.practiceWordHint) {
                        state.settings.practiceReveal = false;
                    } else if (revealProvided && state.settings.practiceReveal) {
                        state.settings.practiceWordHint = false;
                    } else if (revealWhenHintDisabled) {
                        state.settings.practiceReveal = true;
                    } else if (state.settings.practiceReveal) {
                        state.settings.practiceWordHint = false;
                    } else if (state.settings.practiceWordHint) {
                        state.settings.practiceReveal = false;
                    }
                    syncPracticePreviewToggles();
                    saveSettings(state.settings);
                    refreshPracticeView();
                }

                function handleScroll() {
                    scheduleCursorUpdate();
                }

                function handleKeydown(event) {
                    if (handleCommonStudyShortcut(event)) {
                        return;
                    }
                    if (event.shiftKey) {
                        const key = event.key.toLowerCase();
                        if (key === "e") {
                            event.preventDefault();
                            navigateTo("backLink");
                            return;
                        }
                        if (key === "k") {
                            event.preventDefault();
                            toggleKoreanVisibility();
                            return;
                        }
                        if (key === "o") {
                            event.preventDefault();
                            setPracticePreviewSettings({
                                practiceReveal: !state.settings.practiceReveal,
                            });
                            return;
                        }
                        if (key === "h") {
                            event.preventDefault();
                            setPracticePreviewSettings({
                                practiceWordHint: !state.settings.practiceWordHint,
                            }, true);
                            return;
                        }
                    }

                    if (event.ctrlKey) {
                        if (event.key === "ArrowLeft" && getLinkHref("previousTextLink")) {
                            event.preventDefault();
                            navigateTo("previousTextLink");
                        }
                        if (event.key === "ArrowRight" && getLinkHref("nextTextLink")) {
                            event.preventDefault();
                            navigateTo("nextTextLink");
                        }
                        return;
                    }

                    if (event.metaKey || event.altKey) {
                        return;
                    }

                    if (event.key === "Backspace") {
                        event.preventDefault();
                        if (currentIndex > 0) {
                            do {
                                currentIndex -= 1;
                                const span = characters[currentIndex];
                                span.classList.remove("correct", "incorrect");
                                span.textContent = englishText[currentIndex];
                                typedCharacters[currentIndex] = null;
                            } while (currentIndex > 0 && isSkippedCharacter(currentIndex - 1));
                        }
                        refreshPracticeView();
                        return;
                    }

                    if (event.key.length !== 1) {
                        return;
                    }

                    event.preventDefault();
                    skipAutoCharacters();
                    if (currentIndex >= characters.length) {
                        refreshPracticeView();
                        checkPracticeCompletion();
                        return;
                    }

                    const span = characters[currentIndex];
                    const correctChar = englishText[currentIndex];
                    if (event.key.toLowerCase() === correctChar.toLowerCase()) {
                        span.textContent = correctChar;
                        span.classList.remove("incorrect");
                        span.classList.add("correct");
                        typedCharacters[currentIndex] = correctChar;
                        currentIndex += 1;
                    } else if (correctChar !== " " && event.key !== " ") {
                        span.textContent = event.key;
                        span.classList.add("incorrect");
                        typedCharacters[currentIndex] = event.key;
                        currentIndex += 1;
                    }

                    skipAutoCharacters();
                    if (currentIndex < characters.length) {
                        characters[currentIndex].scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                    refreshPracticeView();
                    checkPracticeCompletion();
                }

                function handleVisibilityChange() {
                    setPracticePreviewSettings({
                        practiceReveal: visibilityToggle.checked,
                    });
                }

                function handlePartialPreviewChange() {
                    setPracticePreviewSettings({
                        practiceWordHint: partialPreviewToggle.checked,
                    }, true);
                }

                function handleDarkModeChange() {
                    state.settings.darkMode = darkModeToggle.checked;
                    saveSettings(state.settings);
                    applyTheme(state.settings);
                }

                if (state.settings.practiceReveal && state.settings.practiceWordHint) {
                    state.settings.practiceWordHint = false;
                    saveSettings(state.settings);
                }
                syncPracticePreviewToggles();
                visibilityToggle.addEventListener("change", handleVisibilityChange);
                partialPreviewToggle.addEventListener("change", handlePartialPreviewChange);
                darkModeToggle.addEventListener("change", handleDarkModeChange);
                if (koreanToggle) {
                    koreanToggle.addEventListener("change", toggleKoreanVisibility);
                }
                textDisplay.addEventListener("scroll", handleScroll);
                document.addEventListener("keydown", handleKeydown);

                if ("ResizeObserver" in window) {
                    resizeObserver = new ResizeObserver(scheduleCursorUpdate);
                    resizeObserver.observe(textDisplay);
                }

                applyKoreanVisibility(koreanText);
                if (typeof practiceProgress.koreanVisible === "boolean") {
                    state.koreanVisible = practiceProgress.koreanVisible;
                    applyKoreanVisibility(koreanText);
                }
                updateKoreanToggle();
                if (Array.isArray(practiceProgress.typedCharacters)) {
                    currentIndex = Math.min(
                        Number.isInteger(practiceProgress.currentIndex) ? practiceProgress.currentIndex : 0,
                        characters.length,
                    );
                    for (let index = 0; index < currentIndex; index += 1) {
                        const span = characters[index];
                        if (!span) {
                            continue;
                        }
                        const typedValue = typedCharacters[index];
                        const correctChar = englishText[index];

                        if (typedValue != null) {
                            const normalizedTypedValue = String(typedValue);
                            if (normalizedTypedValue.toLowerCase() === correctChar.toLowerCase()) {
                                span.textContent = correctChar;
                                span.classList.add("correct");
                            } else {
                                span.textContent = normalizedTypedValue;
                                span.classList.add("incorrect");
                            }
                        } else if (isSkippedCharacter(index)) {
                            markCharacterCorrect(index);
                        }
                    }
                }
                skipAutoCharacters();
                updateStatus();
                updateKoreanHighlight();
                updateCursor(false);
                scheduleCursorUpdate();
                if (!isModeTransitioning()) {
                    textDisplay.focus();
                }

                cleanup = () => {
                    persistPracticeProgress();
                    if (cursorFrame !== null) {
                        cancelAnimationFrame(cursorFrame);
                    }
                    if (resizeObserver) {
                        resizeObserver.disconnect();
                    }
                    visibilityToggle.removeEventListener("change", handleVisibilityChange);
                    partialPreviewToggle.removeEventListener("change", handlePartialPreviewChange);
                    darkModeToggle.removeEventListener("change", handleDarkModeChange);
                    if (koreanToggle) {
                        koreanToggle.removeEventListener("change", toggleKoreanVisibility);
                    }
                    textDisplay.removeEventListener("scroll", handleScroll);
                    document.removeEventListener("keydown", handleKeydown);
                };
                persistCurrentMode = persistPracticeProgress;
            }

            function initializeFillMode() {
                document.body.classList.remove("hide-upcoming");
                const originalTextContent = state.text.english_content || "";
                const koreanText = state.text.korean_content || "";
                const linePairs = state.text.line_pairs || [];
                const textDisplay = document.getElementById("text-display");
                const switchContainer = document.getElementById("switchContainer");
                const statusText = document.getElementById("statusText");
                const koreanWidget = document.getElementById("korean-widget");
                const cursor = document.getElementById("cursor");
                cursor.style.opacity = "0";

                switchContainer.innerHTML = `
                    ${koreanText ? '<div class="switch-group"><label class="switch"><input type="checkbox" id="toggle-korean"><span class="slider"></span></label><label for="toggle-korean" class="switch-label">한글 (Shift+K)</label></div>' : ''}
                    <div class="switch-group">
                        <label class="switch"><input type="checkbox" id="toggle-preview"><span class="slider"></span></label>
                        <label for="toggle-preview" class="switch-label">미리보기 (Shift+H)</label>
                    </div>
                    <div class="switch-group">
                        <label class="switch"><input type="checkbox" id="toggle-first-letter"><span class="slider"></span></label>
                        <label for="toggle-first-letter" class="switch-label">앞글자만 보기 (Shift+I)</label>
                    </div>
                    <div class="switch-group">
                        <label class="switch"><input type="checkbox" id="darkModeToggle"><span class="slider"></span></label>
                        <label for="darkModeToggle" class="switch-label">다크모드</label>
                    </div>
                `;
                updateDarkModeToggle(state.settings);

                const previewToggle = document.getElementById("toggle-preview");
                const firstLetterToggle = document.getElementById("toggle-first-letter");
                const darkModeToggle = document.getElementById("darkModeToggle");
                const koreanToggle = document.getElementById("toggle-korean");
                const fillProgress = getTextProgress().fill || {};

                previewToggle.checked = state.settings.fillPreview;
                firstLetterToggle.checked = state.settings.fillFirstLetter;

                const blanks = [];
                const koreanSentences = [];
                const engBoundaries = getEnglishLineBoundaries(linePairs, originalTextContent.replace(/\*\*/g, ""));
                const engToKorMap = engBoundaries.map((_, index) => index);
                let currentBlankIndex = -1;

                if (koreanText) {
                    getTranslationLines(linePairs, koreanText).forEach((sentence, index) => {
                        const span = document.createElement("span");
                        span.innerText = sentence;
                        span.dataset.korIndex = String(index);
                        koreanWidget.appendChild(span);
                        koreanSentences.push(span);
                    });
                }

                function updateStatus() {
                    statusText.textContent = "";
                }

                function updateKoreanToggle() {
                    if (!koreanToggle) {
                        return;
                    }
                    koreanToggle.classList.toggle("active", Boolean(state.koreanVisible));
                    koreanToggle.checked = Boolean(state.koreanVisible);
                    koreanToggle.setAttribute("aria-pressed", String(Boolean(state.koreanVisible)));
                }

                function toggleKoreanVisibility() {
                    if (!koreanText) {
                        return;
                    }
                    state.koreanVisible = !state.koreanVisible;
                    applyKoreanVisibility(koreanText);
                    updateKoreanToggle();
                    updateKoreanHighlight();
                    persistFillProgress();
                }

                function updateKoreanHighlight() {
                    if (!koreanSentences.length || currentBlankIndex < 0 || currentBlankIndex >= blanks.length) {
                        return;
                    }

                    const currentBlank = blanks[currentBlankIndex];
                    const engIndex = Number.parseInt(currentBlank.dataset.engSentenceIndex || "-1", 10);
                    if (Number.isNaN(engIndex) || engIndex < 0) {
                        return;
                    }

                    const korIndex = engToKorMap[engIndex];
                    if (korIndex === undefined || korIndex >= koreanSentences.length) {
                        return;
                    }

                    koreanSentences.forEach((span, index) => {
                        span.classList.toggle("highlight", index === korIndex);
                    });

                    if (document.body.classList.contains("korean-visible")) {
                        koreanSentences[korIndex].scrollIntoView({ behavior: "smooth", block: "center" });
                    }
                }

                function updatePreview() {
                    const activeInput = currentBlankIndex >= 0 ? blanks[currentBlankIndex] : null;
                    blanks.forEach((input) => {
                        const wrapper = input.parentElement;
                        const previewSpan = wrapper.querySelector(".preview-span");
                        const showPreview = input === activeInput && (state.settings.fillPreview || state.settings.fillFirstLetter);
                        if (showPreview) {
                            previewSpan.innerText = state.settings.fillFirstLetter
                                ? (input.dataset.correct || "").charAt(0)
                                : (input.dataset.correct || "");
                        } else {
                            previewSpan.innerText = "";
                        }
                        wrapper.classList.toggle("preview-mode", showPreview);
                        input.classList.toggle("active", input === activeInput);
                        input.readOnly = showPreview;
                    });
                    persistFillProgress();
                }

                function persistFillProgress() {
                    saveTextProgress("fill", {
                        values: blanks.map((input) => input.value || ""),
                        currentBlankIndex,
                        koreanVisible: state.koreanVisible,
                    });
                }

                function focusAndScroll(index) {
                    if (index >= 0 && index < blanks.length) {
                        currentBlankIndex = index;
                        const input = blanks[index];
                        input.focus();
                        input.scrollIntoView({ behavior: "smooth", block: "center" });
                        updatePreview();
                        updateKoreanHighlight();
                    }
                }

                function renderText() {
                    textDisplay.innerHTML = "";
                    const blankRegex = /\*\*(.*?)\*\*/g;
                    let match;
                    let lastIndex = 0;
                    let plainTextCursor = 0;

                    while ((match = blankRegex.exec(originalTextContent)) !== null) {
                        const precedingText = originalTextContent.substring(lastIndex, match.index);
                        if (precedingText) {
                            textDisplay.appendChild(document.createTextNode(precedingText));
                            plainTextCursor += precedingText.length;
                        }

                        const word = match[1];
                        const wrapper = document.createElement("span");
                        wrapper.classList.add("blank-wrapper");

                        const input = document.createElement("input");
                        input.type = "text";
                        input.classList.add("blank-input");
                        input.dataset.correct = word;
                        input.style.width = `${Math.max(1, word.length) * 1.1}ch`;

                        let sentenceIndex = engBoundaries.findIndex((boundary) => plainTextCursor < boundary.end);
                        if (sentenceIndex === -1) {
                            sentenceIndex = engBoundaries.length ? engBoundaries.length - 1 : 0;
                        }
                        input.dataset.engSentenceIndex = String(sentenceIndex);

                        const previewSpan = document.createElement("span");
                        previewSpan.classList.add("preview-span");

                        wrapper.appendChild(input);
                        wrapper.appendChild(previewSpan);
                        textDisplay.appendChild(wrapper);
                        blanks.push(input);

                        lastIndex = blankRegex.lastIndex;
                        plainTextCursor += word.length;
                    }

                    if (lastIndex < originalTextContent.length) {
                        textDisplay.appendChild(document.createTextNode(originalTextContent.substring(lastIndex)));
                    }
                }

                function handleInput(event) {
                    const input = event.target;
                    if (!input.classList.contains("blank-input")) {
                        return;
                    }
                    const answer = (input.dataset.correct || "").toLowerCase();
                    const value = (input.value || "").toLowerCase();
                    input.classList.toggle("correct", value === answer);
                    input.classList.toggle("incorrect", Boolean(value) && value !== answer);
                    updateStatus();
                    persistFillProgress();
                    checkFillCompletion();
                }

                function checkFillCompletion() {
                    const complete = blanks.length > 0 && blanks.every((blank) => {
                        const answer = (blank.dataset.correct || "").toLowerCase();
                        const value = (blank.value || "").toLowerCase();
                        return value === answer;
                    });
                    if (complete) {
                        showModeCompletionNotice("fill");
                    }
                }

                function handleFocus(event) {
                    if (!event.target.classList.contains("blank-input")) {
                        return;
                    }
                    currentBlankIndex = blanks.indexOf(event.target);
                    updatePreview();
                    updateKoreanHighlight();
                }

                function handleBlur(event) {
                    if (!event.target.classList.contains("blank-input")) {
                        return;
                    }
                    setTimeout(() => {
                        if (!textDisplay.contains(document.activeElement)) {
                            currentBlankIndex = -1;
                            updatePreview();
                        }
                    }, 0);
                }

                function handleKeydown(event) {
                    if (handleCommonStudyShortcut(event)) {
                        return;
                    }
                    if (event.shiftKey) {
                        const key = event.key.toLowerCase();
                        if (key === "e") {
                            event.preventDefault();
                            navigateTo("backLink");
                            return;
                        }
                        if (key === "k") {
                            event.preventDefault();
                            toggleKoreanVisibility();
                            return;
                        }
                        if (key === "h") {
                            event.preventDefault();
                            state.settings.fillPreview = !state.settings.fillPreview;
                            if (state.settings.fillPreview) {
                                state.settings.fillFirstLetter = false;
                            }
                            previewToggle.checked = state.settings.fillPreview;
                            firstLetterToggle.checked = state.settings.fillFirstLetter;
                            saveSettings(state.settings);
                            updatePreview();
                            return;
                        }
                        if (key === "i") {
                            event.preventDefault();
                            state.settings.fillFirstLetter = !state.settings.fillFirstLetter;
                            if (state.settings.fillFirstLetter) {
                                state.settings.fillPreview = false;
                            }
                            previewToggle.checked = state.settings.fillPreview;
                            firstLetterToggle.checked = state.settings.fillFirstLetter;
                            saveSettings(state.settings);
                            updatePreview();
                            return;
                        }
                        if (event.key === "ArrowRight") {
                            event.preventDefault();
                            focusAndScroll(currentBlankIndex + 1);
                            return;
                        }
                        if (event.key === "ArrowLeft") {
                            event.preventDefault();
                            focusAndScroll(currentBlankIndex - 1);
                            return;
                        }
                    }

                    if (event.ctrlKey) {
                        if (event.key === "ArrowLeft" && getLinkHref("previousTextLink")) {
                            event.preventDefault();
                            navigateTo("previousTextLink");
                        }
                        if (event.key === "ArrowRight" && getLinkHref("nextTextLink")) {
                            event.preventDefault();
                            navigateTo("nextTextLink");
                        }
                        return;
                    }

                    if (event.key === "Enter") {
                        event.preventDefault();
                        if (currentBlankIndex < blanks.length - 1) {
                            focusAndScroll(currentBlankIndex + 1);
                        }
                    }
                }

                function handlePreviewChange() {
                    state.settings.fillPreview = previewToggle.checked;
                    if (previewToggle.checked) {
                        state.settings.fillFirstLetter = false;
                        firstLetterToggle.checked = false;
                    }
                    saveSettings(state.settings);
                    updatePreview();
                }

                function handleFirstLetterChange() {
                    state.settings.fillFirstLetter = firstLetterToggle.checked;
                    if (firstLetterToggle.checked) {
                        state.settings.fillPreview = false;
                        previewToggle.checked = false;
                    }
                    saveSettings(state.settings);
                    updatePreview();
                }

                function handleDarkModeChange() {
                    state.settings.darkMode = darkModeToggle.checked;
                    saveSettings(state.settings);
                    applyTheme(state.settings);
                }

                renderText();
                textDisplay.addEventListener("input", handleInput);
                textDisplay.addEventListener("focusin", handleFocus);
                textDisplay.addEventListener("focusout", handleBlur);

                previewToggle.addEventListener("change", handlePreviewChange);
                firstLetterToggle.addEventListener("change", handleFirstLetterChange);
                darkModeToggle.addEventListener("change", handleDarkModeChange);
                if (koreanToggle) {
                    koreanToggle.addEventListener("change", toggleKoreanVisibility);
                }
                document.addEventListener("keydown", handleKeydown);

                applyKoreanVisibility(koreanText);
                if (typeof fillProgress.koreanVisible === "boolean") {
                    state.koreanVisible = fillProgress.koreanVisible;
                    applyKoreanVisibility(koreanText);
                }
                updateKoreanToggle();
                if (Array.isArray(fillProgress.values)) {
                    blanks.forEach((input, index) => {
                        const value = fillProgress.values[index];
                        if (typeof value === "string") {
                            input.value = value;
                            const answer = (input.dataset.correct || "").toLowerCase();
                            const normalized = value.toLowerCase();
                            input.classList.toggle("correct", normalized === answer);
                            input.classList.toggle("incorrect", Boolean(value) && normalized !== answer);
                        }
                    });
                }
                updateStatus();
                if (blanks.length) {
                    const savedBlankIndex = Number.isInteger(fillProgress.currentBlankIndex)
                        ? fillProgress.currentBlankIndex
                        : 0;
                    currentBlankIndex = Math.min(Math.max(savedBlankIndex, 0), blanks.length - 1);
                    if (isModeTransitioning()) {
                        updatePreview();
                        updateKoreanHighlight();
                    } else {
                        focusAndScroll(currentBlankIndex);
                    }
                }

                cleanup = () => {
                    persistFillProgress();
                    textDisplay.removeEventListener("input", handleInput);
                    textDisplay.removeEventListener("focusin", handleFocus);
                    textDisplay.removeEventListener("focusout", handleBlur);
                    previewToggle.removeEventListener("change", handlePreviewChange);
                    firstLetterToggle.removeEventListener("change", handleFirstLetterChange);
                    darkModeToggle.removeEventListener("change", handleDarkModeChange);
                    if (koreanToggle) {
                        koreanToggle.removeEventListener("change", toggleKoreanVisibility);
                    }
                    document.removeEventListener("keydown", handleKeydown);
                };
                persistCurrentMode = persistFillProgress;
            }

            function initializeLineMode() {
                document.body.classList.remove("hide-upcoming", "korean-visible");
                document.body.classList.add("line-mode-active");
                state.koreanVisible = false;

                const textDisplay = document.getElementById("text-display");
                const switchContainer = document.getElementById("switchContainer");
                const statusText = document.getElementById("statusText");
                const koreanWidget = document.getElementById("korean-widget");
                const cursor = document.getElementById("cursor");
                const englishText = (state.text.english_content || "").replace(/\*\*/g, "");
                const koreanText = state.text.korean_content || "";
                const linePairs = state.text.line_pairs || [];
                const lineProgress = getTextProgress().line || {};
                let activeIndex = 0;
                let resizeObserver = null;
                let touchStartY = null;
                let touchStartX = null;
                let touchTracking = false;

                cursor.style.opacity = "0";
                koreanWidget.innerHTML = "";
                switchContainer.innerHTML = `
                    <div class="switch-group">
                        <label class="switch"><input type="checkbox" id="darkModeToggle"><span class="slider"></span></label>
                        <label for="darkModeToggle" class="switch-label">다크모드</label>
                    </div>
                `;
                updateDarkModeToggle(state.settings);

                const darkModeToggle = document.getElementById("darkModeToggle");
                const englishLines = Array.isArray(linePairs) && linePairs.length
                    ? linePairs.map((pair) => (pair.english || "").replace(/\*\*/g, ""))
                    : splitIntoSentences(englishText).sentences;
                const koreanLines = Array.isArray(linePairs) && linePairs.length
                    ? linePairs.map((pair) => pair.korean || "")
                    : getTranslationLines(linePairs, koreanText);
                const maxLineCount = Math.max(englishLines.length, koreanLines.length);
                const lineEntries = Array.from({ length: maxLineCount }, (_, index) => ({
                    english: englishLines[index] || "",
                    korean: koreanLines[index] || "해석 없음",
                }));
                const cards = [];

                textDisplay.innerHTML = `
                    <div class="line-camera" id="line-camera">
                        <div class="line-scene" id="line-scene"></div>
                    </div>
                `;

                const camera = document.getElementById("line-camera");
                const scene = document.getElementById("line-scene");

                function updateStatus() {
                    statusText.textContent = "";
                }

                function renderScene() {
                    scene.innerHTML = "";
                    cards.length = 0;

                    if (!lineEntries.length) {
                        const emptyState = document.createElement("article");
                        emptyState.className = "line-scene-card empty";
                        emptyState.innerHTML = '<p class="line-empty-text"></p>';
                        scene.appendChild(emptyState);
                        return;
                    }

                    lineEntries.forEach((entry, index) => {
                        const card = document.createElement("article");
                        card.className = "line-scene-card";
                        card.dataset.index = String(index);
                        card.innerHTML = `
                            <div class="line-card-order">${String(index + 1).padStart(2, "0")}</div>
                            <div class="line-card-body">
                                <p class="line-card-english">${escapeHtml(entry.english || "")}</p>
                                <p class="line-card-korean">${escapeHtml(entry.korean || "해석 없음")}</p>
                            </div>
                        `;
                        card.addEventListener("click", () => setActiveLine(index));
                        scene.appendChild(card);
                        cards.push(card);
                    });
                }

                function updateCardStates() {
                    cards.forEach((card, index) => {
                        const distance = index - activeIndex;
                        const absolute = Math.abs(distance);
                        card.classList.toggle("active", distance === 0);
                        card.classList.toggle("near", absolute === 1);
                        card.classList.toggle("far", absolute >= 2);
                        card.classList.toggle("before-active", distance < 0);
                        card.classList.toggle("after-active", distance > 0);
                    });
                }

                function syncScenePadding() {
                    const firstCard = cards[0];
                    const lastCard = cards[cards.length - 1];
                    if (!firstCard || !lastCard) {
                        return;
                    }

                    const topPadding = Math.max(24, (camera.clientHeight - firstCard.offsetHeight) / 2);
                    const bottomPadding = Math.max(24, (camera.clientHeight - lastCard.offsetHeight) / 2);
                    scene.style.paddingTop = `${topPadding}px`;
                    scene.style.paddingBottom = `${bottomPadding}px`;
                }

                function updateCamera(animate = true) {
                    const activeCard = cards[activeIndex];
                    if (!activeCard) {
                        scene.style.transform = "translateY(0)";
                        updateStatus();
                        return;
                    }

                    const target = activeCard.offsetTop - ((camera.clientHeight - activeCard.offsetHeight) / 2);
                    scene.style.transition = animate ? "" : "none";
                    scene.style.transform = `translateY(${-Math.max(0, target)}px)`;
                    if (!animate) {
                        void scene.offsetHeight;
                        scene.style.transition = "";
                    }
                    updateStatus();
                }

                function setActiveLine(index, animate = true) {
                    if (!maxLineCount) {
                        updateStatus();
                        return;
                    }
                    const nextIndex = Math.min(Math.max(index, 0), maxLineCount - 1);
                    if (nextIndex === activeIndex) {
                        updateCardStates();
                        updateCamera(animate);
                        return;
                    }
                    activeIndex = nextIndex;
                    updateCardStates();
                    updateCamera(animate);
                    persistLineProgress();
                    checkLineCompletion();
                }

                function persistLineProgress() {
                    saveTextProgress("line", { activeIndex });
                }

                function checkLineCompletion() {
                    if (maxLineCount > 0 && activeIndex >= maxLineCount - 1) {
                        showModeCompletionNotice("line");
                    }
                }

                function handleKeydown(event) {
                    if (handleCommonStudyShortcut(event)) {
                        return;
                    }
                    if (event.shiftKey && event.key.toLowerCase() === "e") {
                        event.preventDefault();
                        navigateTo("backLink");
                        return;
                    }

                    if (event.ctrlKey) {
                        if (event.key === "ArrowLeft" && getLinkHref("previousTextLink")) {
                            event.preventDefault();
                            navigateTo("previousTextLink");
                            return;
                        }
                        if (event.key === "ArrowRight" && getLinkHref("nextTextLink")) {
                            event.preventDefault();
                            navigateTo("nextTextLink");
                            return;
                        }
                    }

                    if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setActiveLine(activeIndex + 1);
                        return;
                    }
                    if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setActiveLine(activeIndex - 1);
                        return;
                    }
                    if (event.key === "Home") {
                        event.preventDefault();
                        setActiveLine(0);
                        return;
                    }
                    if (event.key === "End") {
                        event.preventDefault();
                        setActiveLine(maxLineCount - 1);
                    }
                }

                function handleDarkModeChange() {
                    state.settings.darkMode = darkModeToggle.checked;
                    saveSettings(state.settings);
                    applyTheme(state.settings);
                    requestAnimationFrame(() => {
                        syncScenePadding();
                        updateCamera(false);
                    });
                }

                function handleTouchStart(event) {
                    if (!event.touches || event.touches.length !== 1) {
                        touchTracking = false;
                        return;
                    }

                    touchTracking = true;
                    touchStartY = event.touches[0].clientY;
                    touchStartX = event.touches[0].clientX;
                }

                function handleTouchMove(event) {
                    if (!touchTracking || !event.touches || event.touches.length !== 1) {
                        return;
                    }

                    const deltaY = event.touches[0].clientY - touchStartY;
                    const deltaX = event.touches[0].clientX - touchStartX;

                    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 18) {
                        event.preventDefault();
                    }
                }

                function handleTouchEnd(event) {
                    if (!touchTracking) {
                        return;
                    }

                    const touch = event.changedTouches && event.changedTouches[0];
                    touchTracking = false;
                    if (!touch) {
                        return;
                    }

                    const deltaY = touch.clientY - touchStartY;
                    const deltaX = touch.clientX - touchStartX;
                    touchStartY = null;
                    touchStartX = null;

                    if (Math.abs(deltaY) < 44 || Math.abs(deltaY) <= Math.abs(deltaX)) {
                        return;
                    }

                    if (deltaY < 0) {
                        setActiveLine(activeIndex + 1);
                    } else {
                        setActiveLine(activeIndex - 1);
                    }
                }

                renderScene();
                if (Number.isInteger(lineProgress.activeIndex)) {
                    activeIndex = Math.min(Math.max(lineProgress.activeIndex, 0), Math.max(0, maxLineCount - 1));
                }
                updateCardStates();
                syncScenePadding();
                updateCamera(false);
                darkModeToggle.addEventListener("change", handleDarkModeChange);
                camera.addEventListener("touchstart", handleTouchStart, { passive: true });
                camera.addEventListener("touchmove", handleTouchMove, { passive: false });
                camera.addEventListener("touchend", handleTouchEnd, { passive: true });
                camera.addEventListener("touchcancel", handleTouchEnd, { passive: true });

                if ("ResizeObserver" in window) {
                    resizeObserver = new ResizeObserver(() => {
                        syncScenePadding();
                        updateCamera(false);
                    });
                    resizeObserver.observe(camera);
                    resizeObserver.observe(scene);
                    cards.forEach((card) => resizeObserver.observe(card));
                }

                document.addEventListener("keydown", handleKeydown);

                cleanup = () => {
                    persistLineProgress();
                    if (resizeObserver) {
                        resizeObserver.disconnect();
                    }
                    darkModeToggle.removeEventListener("change", handleDarkModeChange);
                    camera.removeEventListener("touchstart", handleTouchStart);
                    camera.removeEventListener("touchmove", handleTouchMove);
                    camera.removeEventListener("touchend", handleTouchEnd);
                    camera.removeEventListener("touchcancel", handleTouchEnd);
                    document.removeEventListener("keydown", handleKeydown);
                };
                persistCurrentMode = persistLineProgress;
            }

            function initializeStudyPage() {
                applyTheme(state.settings);
                updateDarkModeToggle(state.settings);
                document.body.classList.toggle("line-mode-active", state.mode === "line");

                if (state.mode === "fill") {
                    initializeFillMode();
                } else if (state.mode === "line") {
                    initializeLineMode();
                } else {
                    initializePracticeMode();
                }
            }

            initializeStudyPage();

            function handlePageHide() {
                persistCurrentMode();
            }

            window.addEventListener("pagehide", handlePageHide);

            return () => {
                persistCurrentMode();
                cleanup();
                if (completionNoticeTimer !== null) {
                    window.clearTimeout(completionNoticeTimer);
                }
                if (completionNoticeKeyHandler) {
                    document.removeEventListener("keydown", completionNoticeKeyHandler, true);
                }
                if (completionConfetti) {
                    completionConfetti.destroy();
                }
                if (fullscreenToggle) {
                    fullscreenToggle.removeEventListener("click", handleFullscreenToggle);
                }
                window.removeEventListener("pagehide", handlePageHide);
                document.body.classList.remove("hide-upcoming", "korean-visible", "line-mode-active", "study-fullscreen-active");
            };
        },
    };
}());
