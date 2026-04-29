(async () => {
  const debug = [];
  const startedAt = new Date();

  const log = (step, data = {}) => {
    debug.push({
      time: new Date().toISOString(),
      step,
      ...data,
    });
  };

  const saveTextFile = (text, fileName, type = "text/plain;charset=utf-8") => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: fileName,
    });

    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const saveDebugLog = (reason) => {
    log("debug_log_save", { reason });

    const text = [
      "# Wrtn JSONL Export Debug Log",
      `started_at: ${startedAt.toISOString()}`,
      `finished_at: ${new Date().toISOString()}`,
      `reason: ${reason}`,
      "",
      JSON.stringify(debug, null, 2),
    ].join("\n");

    saveTextFile(text, `wrtn-export-debug-${Date.now()}.log`);
  };

  if (window.__wrtnJsonlExporterRunning) {
    alert("이미 실행 중입니다.");
    return;
  }

  window.__wrtnJsonlExporterRunning = true;

  try {
    log("start", {
      href: location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      readyState: document.readyState,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      bodyTextLength: document.body?.innerText?.length || 0,
    });

    const user = prompt("user 이름을 입력하세요", "");
    if (user === null) {
      log("cancel_user_prompt");
      saveDebugLog("cancel_user_prompt");
      return;
    }

    const char = prompt("ai 캐릭터의 이름을 입력하세요", "");
    if (char === null) {
      log("cancel_char_prompt");
      saveDebugLog("cancel_char_prompt");
      return;
    }

    let fileName = prompt("저장할 파일명을 입력하세요", "messages.jsonl");
    if (fileName === null) {
      log("cancel_file_prompt");
      saveDebugLog("cancel_file_prompt");
      return;
    }

    fileName = fileName.trim() || "messages.jsonl";
    if (!fileName.toLowerCase().endsWith(".jsonl")) {
      fileName += ".jsonl";
    }

    log("prompt_done", {
      user,
      char,
      fileName,
    });

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const escapeAttr = (value) => String(value)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const visibleInfo = (el) => {
      if (!el) return null;

      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);

      return {
        tag: el.tagName,
        text: el.innerText?.trim().slice(0, 160) || "",
        ariaLabel: el.getAttribute("aria-label"),
        role: el.getAttribute("role"),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        display: style.display,
        visibility: style.visibility,
        html: el.outerHTML?.slice(0, 500) || "",
      };
    };

    const pointerDown = (el, label = "element") => {
      if (!el) {
        log("pointerdown_skip_null", { label });
        return false;
      }

      log("pointerdown", {
        label,
        element: visibleInfo(el),
      });

      el.dispatchEvent(new MouseEvent("Mousedown", {
        bubbles: true,
      }));

      return true;
    };

    const findEditItem = async (timeout = 3000) => {
      const endAt = Date.now() + timeout;
      let loops = 0;

      while (Date.now() < endAt) {
        loops += 1;

        const menuItems = [...document.querySelectorAll('div[role="menuitem"]')];
        const editItem = menuItems.find((el) => el.innerText.trim() === "수정");

        if (editItem) {
          log("edit_item_found", {
            loops,
            menuItemCount: menuItems.length,
            editItem: visibleInfo(editItem),
          });
          return editItem;
        }

        if (loops === 1 || loops % 10 === 0) {
          log("edit_item_waiting", {
            loops,
            menuItemCount: menuItems.length,
            roleSamples: [...document.querySelectorAll("[role]")]
              .slice(0, 25)
              .map(visibleInfo),
            editTextCandidates: [...document.querySelectorAll("button, div, span, li, a")]
              .filter((el) => el.innerText?.trim().includes("수정"))
              .slice(0, 15)
              .map(visibleInfo),
          });
        }

        await sleep(100);
      }

      log("edit_item_timeout", { timeout });
      return null;
    };

    const markdownToHtml = (text) => String(text || "")
      .trim()
      .replace(/!\[([^\]]*)\]\(\s*([^)]+?)\s*\)/g, (_match, alt, src) => (
        `<img alt="${escapeAttr(alt)}" src="${escapeAttr(src)}">`
      ));

    log("selectors_before_edit", {
      optionButtonCount: document.querySelectorAll('button[aria-label="메시지 옵션"]').length,
      messageGroupCount: document.querySelectorAll("div[data-message-group-id]").length,
      textareaCount: document.querySelectorAll("textarea").length,
      wrtnMarkdownCount: document.querySelectorAll(".wrtn-markdown").length,
      ariaButtonLabels: [...document.querySelectorAll("button[aria-label]")]
        .slice(0, 80)
        .map((el) => el.getAttribute("aria-label")),
      messageGroupSamples: [...document.querySelectorAll("div[data-message-group-id]")]
        .slice(0, 8)
        .map((el) => ({
          id: el.getAttribute("data-message-group-id"),
          text: el.innerText?.trim().slice(0, 220) || "",
          hasOptionButton: !!el.querySelector('button[aria-label="메시지 옵션"]'),
          hasTextarea: !!el.querySelector("textarea"),
          html: el.outerHTML?.slice(0, 700) || "",
        })),
    });

    const optionButtons = [
      ...document.querySelectorAll('button[aria-label="메시지 옵션"]'),
    ].reverse();

    let openedEditors = 0;
    let missedEditMenus = 0;

    for (const [index, button] of optionButtons.entries()) {
      pointerDown(button, `option_button_${index}`);
      await sleep(100);

      const editItem = await findEditItem();

      if (!editItem) {
        missedEditMenus += 1;
        log("edit_item_missing_after_option", { index });
        continue;
      }

      pointerDown(editItem, `edit_item_${index}`);
      openedEditors += 1;
      await sleep(100);
    }

    const messageGroups = [...document.querySelectorAll("div[data-message-group-id]")];
    const textareas = [...document.querySelectorAll("textarea")];

    log("selectors_after_edit", {
      openedEditors,
      missedEditMenus,
      messageGroupCount: messageGroups.length,
      textareaCount: textareas.length,
      textareaSamples: textareas.slice(0, 20).map((el) => ({
        valueLength: el.value?.length || 0,
        valueSample: el.value?.slice(0, 220) || "",
        element: visibleInfo(el),
      })),
    });

    const rows = messageGroups
      .reverse()
      .map((groupEl, index) => {
        const textarea = groupEl.querySelector("textarea");
        const mes = markdownToHtml(textarea?.value || "");
        const isUser = !!groupEl.querySelector('button[aria-label="메시지 옵션"]');

        if (!mes) {
          log("message_group_skip_empty", {
            index,
            id: groupEl.getAttribute("data-message-group-id"),
            isUser,
            hasTextarea: !!textarea,
            textareaValueLength: textarea?.value?.length || 0,
            textSample: groupEl.innerText?.trim().slice(0, 220) || "",
            html: groupEl.outerHTML?.slice(0, 700) || "",
          });
          return null;
        }

        return {
          name: isUser ? user : char,
          is_user: isUser,
          is_system: false,
          send_date: "",
          mes,
        };
      })
      .filter(Boolean);

    log("rows_created", {
      rowCount: rows.length,
      firstRows: rows.slice(0, 5).map((row) => ({
        name: row.name,
        is_user: row.is_user,
        mesLength: row.mes.length,
        mesSample: row.mes.slice(0, 220),
      })),
    });

    const header = {
      user_name: user,
      character_name: char,
      create_date: new Date().toISOString(),
      chat_metadata: {},
    };

    const jsonl = [header, ...rows].map((row) => JSON.stringify(row)).join("\n");

    saveTextFile(jsonl, fileName, "application/jsonl;charset=utf-8");
    saveDebugLog(rows.length === 0 ? "zero_rows" : "success");

    alert(`${rows.length}개 메시지 저장 완료\n파일명: ${fileName}\n디버그 로그도 함께 저장했습니다.`);
    console.log("[Wrtn JSONL Exporter]", rows);
    console.log("[Wrtn JSONL Exporter Debug]", debug);
  } catch (error) {
    log("error", {
      message: error?.message || String(error),
      stack: error?.stack || "",
    });
    saveDebugLog("error");
    alert(`오류 발생: ${error?.message || error}\n디버그 로그를 저장했습니다.`);
    throw error;
  } finally {
    window.__wrtnJsonlExporterRunning = false;
  }
})();
