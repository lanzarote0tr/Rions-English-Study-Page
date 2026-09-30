(function () {
    const storageKey = "englishStudyAnnotations";
    const annotationTypes = new Set(["underline", "highlight", "box"]);
    const noteTypes = new Set(["underline", "box"]);

    function readStore() {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
            return saved && typeof saved === "object" ? saved : {};
        } catch (error) {
            return {};
        }
    }

    function textSignature(text) {
        let hash = 2166136261;
        for (let index = 0; index < text.length; index += 1) {
            hash ^= text.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return `${text.length}:${(hash >>> 0).toString(16)}`;
    }

    function normalizeAnnotations(items, textLength) {
        if (!Array.isArray(items)) {
            return [];
        }
        return items.flatMap((item) => {
            const start = Number(item && item.start);
            const end = Number(item && item.end);
            const type = item && item.type;
            if (!Number.isInteger(start) || !Number.isInteger(end)
                || start < 0 || end <= start || end > textLength
                || !annotationTypes.has(type)) {
                return [];
            }
            return [{
                id: String(item.id || `${type}-${start}-${end}`),
                start,
                end,
                type,
                note: noteTypes.has(type) ? String(item.note || "").slice(0, 160) : "",
            }];
        });
    }

    function loadAnnotations(textPath, text) {
        const entry = readStore()[textPath];
        if (!entry || entry.signature !== textSignature(text)) {
            return [];
        }
        return normalizeAnnotations(entry.items, text.length);
    }

    function saveAnnotations(textPath, text, annotations) {
        const store = readStore();
        if (annotations.length) {
            store[textPath] = {
                signature: textSignature(text),
                items: annotations,
            };
        } else {
            delete store[textPath];
        }
        localStorage.setItem(storageKey, JSON.stringify(store));
    }

    function createAnnotationId(type) {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return `${type}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function createController(options) {
        const {
            textDisplay,
            switchContainer,
            textPath,
            text,
            sentences = [],
            onSentenceChange,
        } = options;
        let annotations = loadAnnotations(textPath, text);
        let selectedRange = null;
        let editingAnnotationId = null;
        let notePositionFrame = null;
        let noteResizeObserver = null;
        let activeSentence = -1;
        // Trim surrounding whitespace so the sentence background hugs the words.
        const sentenceRanges = sentences.map(({ start, end }) => {
            let trimmedStart = Math.max(0, start);
            let trimmedEnd = Math.min(text.length, end);
            while (trimmedStart < trimmedEnd && /\s/.test(text[trimmedStart])) {
                trimmedStart += 1;
            }
            while (trimmedEnd > trimmedStart && /\s/.test(text[trimmedEnd - 1])) {
                trimmedEnd -= 1;
            }
            return { start: trimmedStart, end: trimmedEnd };
        });

        switchContainer.innerHTML = `
            <div class="annotation-toolbar" role="toolbar" aria-label="필기 도구">
                <button type="button" class="btn btn-sm annotation-tool-underline" data-annotation-action="underline" aria-keyshortcuts="U">밑줄 <kbd>U</kbd></button>
                <button type="button" class="btn btn-sm annotation-tool-highlight" data-annotation-action="highlight" aria-keyshortcuts="H">하이라이트 <kbd>H</kbd></button>
                <button type="button" class="btn btn-sm annotation-tool-box" data-annotation-action="box" aria-keyshortcuts="S">네모 치기 <kbd>S</kbd></button>
                <span class="annotation-toolbar-divider" aria-hidden="true"></span>
                <button type="button" class="btn btn-sm" data-annotation-action="remove" aria-keyshortcuts="D">선택 필기 지우기 <kbd>D</kbd></button>
                <button type="button" class="btn btn-sm" data-annotation-action="clear" aria-keyshortcuts="Shift+D">전체 지우기 <kbd>Shift+D</kbd></button>
            </div>
            <dialog class="dialog" id="annotationNoteDialog" aria-labelledby="annotationNoteTitle">
                <div class="dialog-header">
                    <h2 id="annotationNoteTitle">작은 메모</h2>
                </div>
                <form class="dialog-body" id="annotationNoteForm">
                    <p>밑줄이나 네모 친 부분 아래에 같은 색으로 표시됩니다.</p>
                    <input type="text" class="field" id="annotationNoteInput" maxlength="160" autocomplete="off" aria-label="필기 메모">
                    <div class="dialog-actions">
                        <button type="button" class="btn" id="annotationNoteDelete">메모 삭제</button>
                        <button type="button" class="btn" id="annotationNoteClose">닫기</button>
                        <button type="submit" class="btn btn-primary">저장</button>
                    </div>
                </form>
            </dialog>
        `;

        const toolbar = switchContainer.querySelector(".annotation-toolbar");
        const noteDialog = switchContainer.querySelector("#annotationNoteDialog");
        const noteForm = switchContainer.querySelector("#annotationNoteForm");
        const noteInput = switchContainer.querySelector("#annotationNoteInput");
        const noteDelete = switchContainer.querySelector("#annotationNoteDelete");
        const noteClose = switchContainer.querySelector("#annotationNoteClose");
        const clearDialog = window.EnglishStudy.dialog.confirm({
            container: switchContainer,
            title: "전체 필기 지우기",
            description: "이 글의 밑줄, 하이라이트, 네모와 메모를 모두 삭제합니다. 삭제한 필기는 되돌릴 수 없습니다.",
            confirmLabel: "전체 지우기",
            onConfirm: clearAllAnnotations,
        });

        function persistAnnotations() {
            try {
                saveAnnotations(textPath, text, annotations);
                return true;
            } catch (error) {
                return false;
            }
        }

        // Browsers paint text selection across the full line box, but an inline
        // background only covers the font's content area. Pad the sentence
        // background by the difference so both boxes share the same height.
        function updateSentenceMetrics() {
            const probe = document.createElement("span");
            probe.textContent = "x";
            textDisplay.appendChild(probe);
            const contentHeight = probe.getBoundingClientRect().height;
            probe.remove();
            const lineHeight = Number.parseFloat(getComputedStyle(textDisplay).lineHeight);
            if (!Number.isFinite(lineHeight) || !contentHeight) {
                return;
            }
            const pad = Math.max(0, (lineHeight - contentHeight) / 2);
            textDisplay.style.setProperty("--sentence-pad", `${pad}px`);
        }

        function positionNotes() {
            notePositionFrame = null;
            updateSentenceMetrics();
            const displayRect = textDisplay.getBoundingClientRect();
            const segments = [...textDisplay.querySelectorAll(".annotation-segment")];
            textDisplay.querySelectorAll(".annotation-notes").forEach((group) => {
                const end = Number(group.dataset.annotationEnd);
                const anchor = segments.find((segment) => Number(segment.dataset.annotationEnd) === end);
                if (!anchor) {
                    return;
                }
                const rects = anchor.getClientRects();
                const anchorRect = rects.length ? rects[rects.length - 1] : anchor.getBoundingClientRect();
                const naturalLeft = anchorRect.left - displayRect.left + textDisplay.scrollLeft;
                const maximumLeft = Math.max(8, textDisplay.clientWidth - group.offsetWidth - 8);
                const left = Math.min(Math.max(naturalLeft, 8), maximumLeft);
                const top = anchorRect.bottom - displayRect.top + textDisplay.scrollTop;
                group.style.left = `${left}px`;
                group.style.top = `${top}px`;
            });
        }

        function scheduleNotePosition() {
            if (notePositionFrame !== null) {
                return;
            }
            notePositionFrame = window.requestAnimationFrame(positionNotes);
        }


        function renderText() {
            textDisplay.textContent = "";
            if (!text) {
                return;
            }

            const boundaries = new Set([0, text.length]);
            annotations.forEach((annotation) => {
                boundaries.add(annotation.start);
                boundaries.add(annotation.end);
            });
            sentenceRanges.forEach((range) => {
                boundaries.add(range.start);
                boundaries.add(range.end);
            });
            const sortedBoundaries = [...boundaries].sort((left, right) => left - right);
            const fragment = document.createDocumentFragment();

            for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
                const start = sortedBoundaries[index];
                const end = sortedBoundaries[index + 1];
                if (end <= start) {
                    continue;
                }
                const active = annotations.filter((annotation) => annotation.start < end && annotation.end > start);
                const segment = document.createElement("span");
                segment.className = "annotation-segment";
                segment.dataset.annotationStart = String(start);
                segment.dataset.annotationEnd = String(end);
                segment.textContent = text.slice(start, end);
                const sentenceIndex = sentenceRanges.findIndex((range) => start >= range.start && end <= range.end);
                if (sentenceIndex >= 0) {
                    segment.dataset.sentence = String(sentenceIndex);
                    segment.classList.toggle("annotation-sentence-active", sentenceIndex === activeSentence);
                }
                active.forEach((annotation) => segment.classList.add(`annotation-${annotation.type}`));
                const editable = active.filter((annotation) => noteTypes.has(annotation.type));
                if (editable.length) {
                    segment.dataset.annotationNoteIds = editable.map((annotation) => annotation.id).join(",");
                    segment.title = "클릭해서 작은 메모 작성";
                }
                fragment.appendChild(segment);
            }
            textDisplay.appendChild(fragment);

            const noteGroups = new Map();
            annotations.filter((annotation) => annotation.note).forEach((annotation) => {
                const group = noteGroups.get(annotation.end) || [];
                group.push(annotation);
                noteGroups.set(annotation.end, group);
            });
            noteGroups.forEach((groupAnnotations, end) => {
                const group = document.createElement("span");
                group.className = "annotation-notes";
                group.dataset.annotationEnd = String(end);
                groupAnnotations.forEach((annotation) => {
                    const note = document.createElement("small");
                    note.className = `annotation-note annotation-note-${annotation.type}`;
                    note.dataset.annotationNoteId = annotation.id;
                    note.textContent = annotation.note;
                    note.title = "클릭해서 메모 수정";
                    group.appendChild(note);
                });
                textDisplay.appendChild(group);
            });
            scheduleNotePosition();
        }

        function boundaryFromDisplay(offset) {
            const children = [...textDisplay.childNodes];
            for (let index = offset; index < children.length; index += 1) {
                if (children[index] instanceof HTMLElement && children[index].dataset.annotationStart !== undefined) {
                    return Number(children[index].dataset.annotationStart);
                }
            }
            for (let index = Math.min(offset - 1, children.length - 1); index >= 0; index -= 1) {
                if (children[index] instanceof HTMLElement && children[index].dataset.annotationEnd !== undefined) {
                    return Number(children[index].dataset.annotationEnd);
                }
            }
            return offset <= 0 ? 0 : text.length;
        }

        function selectionOffset(node, offset) {
            if (node === textDisplay) {
                return boundaryFromDisplay(offset);
            }
            const element = node instanceof Element ? node : node.parentElement;
            if (element && element.closest(".annotation-note")) {
                return null;
            }
            const segment = element && element.closest(".annotation-segment");
            if (!segment || !textDisplay.contains(segment)) {
                return null;
            }
            const start = Number(segment.dataset.annotationStart);
            const end = Number(segment.dataset.annotationEnd);
            if (node.nodeType === Node.TEXT_NODE) {
                return Math.min(start + offset, end);
            }
            return offset <= 0 ? start : end;
        }

        function captureSelection() {
            const selection = window.getSelection();
            if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
                selectedRange = null;
                return;
            }
            const range = selection.getRangeAt(0);
            const start = selectionOffset(range.startContainer, range.startOffset);
            const end = selectionOffset(range.endContainer, range.endOffset);
            if (start === null || end === null || start === end) {
                selectedRange = null;
                return;
            }
            selectedRange = {
                start: Math.max(0, Math.min(start, end)),
                end: Math.min(text.length, Math.max(start, end)),
            };
        }

        function clearSelection() {
            selectedRange = null;
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
            }
        }

        function findAnnotation(annotationId) {
            return annotations.find((annotation) => annotation.id === annotationId) || null;
        }

        function openNoteEditor(annotationId) {
            const annotation = findAnnotation(annotationId);
            if (!annotation || !noteTypes.has(annotation.type)) {
                return;
            }
            editingAnnotationId = annotation.id;
            noteInput.value = annotation.note;
            noteDelete.disabled = !annotation.note;
            if (!noteDialog.open) {
                noteDialog.showModal();
            }
            window.requestAnimationFrame(() => {
                noteInput.focus();
                noteInput.select();
            });
        }

        function closeNoteEditor() {
            editingAnnotationId = null;
            if (noteDialog.open) {
                noteDialog.close();
            }
        }

        function hasOpenDialog() {
            return noteDialog.open || clearDialog.isOpen();
        }

        function applyAnnotation(type) {
            if (!selectedRange) {
                return;
            }
            const overlapsSameType = annotations.some((annotation) => annotation.type === type
                && annotation.start < selectedRange.end
                && annotation.end > selectedRange.start);
            if (overlapsSameType) {
                clearSelection();
                return;
            }
            const annotation = {
                id: createAnnotationId(type),
                start: selectedRange.start,
                end: selectedRange.end,
                type,
                note: "",
            };
            annotations.push(annotation);
            annotations.sort((left, right) => left.start - right.start || left.end - right.end);
            persistAnnotations();
            renderText();
            clearSelection();
            if (noteTypes.has(type)) {
                openNoteEditor(annotation.id);
            }
        }

        function removeSelectedAnnotations() {
            if (!selectedRange) {
                return;
            }
            const previousLength = annotations.length;
            annotations = annotations.filter((annotation) => (
                annotation.end <= selectedRange.start || annotation.start >= selectedRange.end
            ));
            if (annotations.length === previousLength) {
                return;
            }
            persistAnnotations();
            renderText();
            clearSelection();
        }

        function requestClearAllAnnotations() {
            if (!annotations.length) {
                return;
            }
            clearSelection();
            clearDialog.open();
        }

        function clearAllAnnotations() {
            annotations = [];
            persistAnnotations();
            renderText();
            clearSelection();
        }

        function handleToolbarPointerDown(event) {
            if (event.target.closest("[data-annotation-action]")) {
                event.preventDefault();
            }
        }

        function handleToolbarClick(event) {
            const button = event.target.closest("[data-annotation-action]");
            if (!button) {
                return;
            }
            const action = button.dataset.annotationAction;
            if (annotationTypes.has(action)) {
                applyAnnotation(action);
            } else if (action === "remove") {
                removeSelectedAnnotations();
            } else if (action === "clear") {
                requestClearAllAnnotations();
            }
        }


        function applyActiveSentence() {
            textDisplay.querySelectorAll(".annotation-segment[data-sentence]").forEach((segment) => {
                segment.classList.toggle("annotation-sentence-active", Number(segment.dataset.sentence) === activeSentence);
            });
        }

        function setActiveSentence(index) {
            if (index === activeSentence) {
                return;
            }
            activeSentence = index;
            applyActiveSentence();
            if (typeof onSentenceChange === "function") {
                onSentenceChange(index);
            }
        }

        function handleTextClick(event) {
            const note = event.target.closest("[data-annotation-note-id]");
            if (note) {
                openNoteEditor(note.dataset.annotationNoteId);
                return;
            }
            if (window.getSelection()?.toString()) {
                return;
            }
            const clickedSegment = event.target.closest(".annotation-segment[data-sentence]");
            if (clickedSegment) {
                setActiveSentence(Number(clickedSegment.dataset.sentence));
            }
            const segment = event.target.closest("[data-annotation-note-ids]");
            if (!segment) {
                return;
            }
            const annotationId = segment.dataset.annotationNoteIds.split(",").at(-1);
            openNoteEditor(annotationId);
        }

        function handleNoteSubmit(event) {
            event.preventDefault();
            const annotation = findAnnotation(editingAnnotationId);
            if (!annotation) {
                closeNoteEditor();
                return;
            }
            annotation.note = noteInput.value.trim().slice(0, 160);
            persistAnnotations();
            renderText();
            closeNoteEditor();
        }

        function handleNoteDelete() {
            const annotation = findAnnotation(editingAnnotationId);
            if (!annotation) {
                closeNoteEditor();
                return;
            }
            annotation.note = "";
            persistAnnotations();
            renderText();
            closeNoteEditor();
        }

        renderText();
        document.addEventListener("selectionchange", captureSelection);
        toolbar.addEventListener("pointerdown", handleToolbarPointerDown);
        toolbar.addEventListener("click", handleToolbarClick);
        textDisplay.addEventListener("click", handleTextClick);
        noteForm.addEventListener("submit", handleNoteSubmit);
        noteDelete.addEventListener("click", handleNoteDelete);
        noteClose.addEventListener("click", closeNoteEditor);
        window.addEventListener("resize", scheduleNotePosition);
        if ("ResizeObserver" in window) {
            noteResizeObserver = new ResizeObserver(scheduleNotePosition);
            noteResizeObserver.observe(textDisplay);
        }

        return {
            noteDialog,
            applyAnnotation,
            hasOpenDialog,
            removeSelectedAnnotations,
            requestClearAllAnnotations,
            destroy() {
                document.removeEventListener("selectionchange", captureSelection);
                toolbar.removeEventListener("pointerdown", handleToolbarPointerDown);
                toolbar.removeEventListener("click", handleToolbarClick);
                textDisplay.removeEventListener("click", handleTextClick);
                noteForm.removeEventListener("submit", handleNoteSubmit);
                noteDelete.removeEventListener("click", handleNoteDelete);
                noteClose.removeEventListener("click", closeNoteEditor);
                window.removeEventListener("resize", scheduleNotePosition);
                if (noteResizeObserver) {
                    noteResizeObserver.disconnect();
                }
                if (notePositionFrame !== null) {
                    window.cancelAnimationFrame(notePositionFrame);
                }
                closeNoteEditor();
                clearDialog.destroy();
                textDisplay.style.removeProperty("--sentence-pad");
            },
        };
    }

    window.EnglishStudyAnnotations = {
        createController,
    };
}());
