(async () => {
  function convertMes(str) {
    if (typeof str !== "string") {
      throw new TypeError("str must be a string");
    }

    let result = "";
    let buffer = "";
    let inAction = false;
    let inCodeBlock = false;

    function quoteText(text) {
      if (!text.trim()) return text;

      const leading = text.match(/^\s*/)[0];
      const trailing = text.match(/\s*$/)[0];
      const core = text.slice(leading.length, text.length - trailing.length);

      return `${leading}"${core}"${trailing}`;
    }

    function flush() {
      if (!buffer) return;

      result += inAction ? buffer : quoteText(buffer);
      buffer = "";
    }

    function escapeRegExp(value) {
      return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function readTagAt(text, index) {
      if (text[index] !== "<") return null;

      const closeIndex = text.indexOf(">", index);
      if (closeIndex === -1) return null;

      const raw = text.slice(index, closeIndex + 1);
      const match = raw.match(/^<\s*(\/?)\s*([^>\s/]+)[^>]*>$/);

      if (!match) return null;

      return {
        raw,
        name: match[2],
        isClosing: match[1] === "/",
        start: index,
        end: closeIndex + 1,
      };
    }

    function findClosingTag(text, tagName, fromIndex) {
      const pattern = new RegExp(`<\\s*\\/\\s*${escapeRegExp(tagName)}\\s*>`, "i");
      const rest = text.slice(fromIndex);
      const match = rest.match(pattern);

      return match ? fromIndex + match.index + match[0].length : -1;
    }

    let i = 0;

    while (i < str.length) {
      if (str.slice(i, i + 3) === "```") {
        flush();
        result += "```";
        inCodeBlock = !inCodeBlock;
        i += 3;
        continue;
      }

      if (inCodeBlock) {
        result += str[i];
        i++;
        continue;
      }

      const tag = readTagAt(str, i);

      if (tag && !tag.isClosing) {
        const closingEnd = findClosingTag(str, tag.name, tag.end);

        if (closingEnd !== -1) {
          flush();
          result += str.slice(i, closingEnd);
          i = closingEnd;
          continue;
        }
      }

      if (str[i] === "*") {
        flush();
        inAction = !inAction;
        i++;
        continue;
      }

      if (str[i] === "\r" || str[i] === "\n") {
        flush();

        if (str[i] === "\r" && str[i + 1] === "\n") {
          result += "\r\n";
          i += 2;
        } else {
          result += str[i];
          i++;
        }

        continue;
      }

      buffer += str[i];
      i++;
    }

    flush();

    return result;
  }

  function getDefaultFileNameBase(characterName) {
    const now = new Date();

    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const mi = String(now.getMinutes()).padStart(2, "0");

    return `${characterName}_${yy}${mm}${dd}_${hh}-${mi}`;
  }

  function getTextareaCount() {
    return document.querySelectorAll(
      "textarea[id^='userChatTextarea-'], textarea[id^='botChatTextarea-']"
    ).length;
  }

  function waitForNewTextareas(beforeCount, expectedIncrease, timeout = 60000) {
    return new Promise((resolve, reject) => {
      const targetCount = beforeCount + expectedIncrease;

      const observer = new MutationObserver(() => {
        const currentCount = getTextareaCount();

        if (currentCount >= targetCount) {
          observer.disconnect();
          clearTimeout(timeoutTimer);
          resolve(currentCount);
        }
      });

      const timeoutTimer = setTimeout(() => {
        observer.disconnect();
        reject(
          new Error(
            `버튼을 누르는 데에 너무 오래 걸리고 있어요. 현재 ${getTextareaCount()}개 / 목표 ${targetCount}개.`
          )
        );
      }, timeout);

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      if (getTextareaCount() >= targetCount) {
        observer.disconnect();
        clearTimeout(timeoutTimer);
        resolve(getTextareaCount());
      }
    });
  }

  function getMessageIndexes() {
    const indexes = new Set();

    document
      .querySelectorAll("textarea[id^='userChatTextarea-'], textarea[id^='botChatTextarea-']")
      .forEach((textarea) => {
        const match = textarea.id.match(/^(?:user|bot)ChatTextarea-(\d+)$/);

        if (match) {
          indexes.add(Number(match[1]));
        }
      });

    return [...indexes].sort((a, b) => a - b);
  }

  if (window.__rofanAiJsonlExporterRunning) {
    alert("이미 실행 중입니다.");
    return;
  }

  window.__rofanAiJsonlExporterRunning = true;

  try {
    const userName = prompt("유저 이름을 입력하세요") || "user";
    const characterName = prompt("캐릭터의 이름을 입력하세요") || "character";
    const firstCharacterMessage =
      prompt("캐릭터 첫 번째 메시지를 붙여넣어주세요. 아무 거나 입력하고 나중에 수정해도 돼요!", "") || "";

    const shouldConvertMes =
      (prompt("대사에 따옴표를 붙이고 행동 지문에서 *를 제거할까요? (예/아니오)", "예") || "아니오")
        .trim()
        .toLowerCase() !== "아니오";

    let skipConvertTexts = [];

    if (shouldConvertMes) {
      skipConvertTexts = (
        prompt("이 문자가 포함된 메시지는 변환하지 않습니다. 여러 개면 쉼표로 구분해주세요. 없으면 비워두세요.", "") || ""
      )
        .split(",")
        .map((text) => text.trim())
        .filter(Boolean);
    }

    const defaultFileNameBase = getDefaultFileNameBase(characterName);

    const outputFileNameBase = (
      prompt("저장할 파일명을 입력하세요. 확장자는 제외하고 입력해주세요.", defaultFileNameBase) || defaultFileNameBase
    )
      .trim()
      .replace(/\.jsonl$/i, "");

    const outputFileName = `${outputFileNameBase || defaultFileNameBase}.jsonl`;

    function makeMes(str) {
      if (skipConvertTexts.some((text) => str.includes(text))) {
        return str;
      }

      return shouldConvertMes ? convertMes(str) : str;
    }

    const lines = [JSON.stringify({ chat_metadata: "" })];

    let collectedMessageCount = 0;

    if (firstCharacterMessage.trim()) {
      lines.push(
        JSON.stringify({
          name: characterName,
          is_user: false,
          is_system: false,
          send_date: "",
          mes: makeMes(firstCharacterMessage),
          extra: {},
          force_avatar: "",
        })
      );

      collectedMessageCount++;
    }

    const beforeTextareaCount = getTextareaCount();

    const buttonsToClick = [...document.querySelectorAll("div.mt-5 > .flex > .flex")]
      .map((container) => container.querySelectorAll("button")[2])
      .filter(Boolean);

    console.log(`클릭할 버튼 수: ${buttonsToClick.length}`);

    if (buttonsToClick.length === 0) {
      alert("메시지를 찾을 수 없습니다. 올바른 페이지인지 확인해주세요.");
      throw new Error("클릭할 버튼 없음");
    }

    buttonsToClick.forEach((button) => button.click());

    await waitForNewTextareas(beforeTextareaCount, buttonsToClick.length * 2);

    for (const i of getMessageIndexes()) {
      const userEl = document.getElementById(`userChatTextarea-${i}`);
      const botEl = document.getElementById(`botChatTextarea-${i}`);

      if (userEl) {
        lines.push(
          JSON.stringify({
            name: userName,
            is_user: true,
            is_system: false,
            send_date: "",
            mes: makeMes(userEl.value),
            extra: {},
            force_avatar: "",
          })
        );

        collectedMessageCount++;
      }

      if (botEl) {
        lines.push(
          JSON.stringify({
            name: characterName,
            is_user: false,
            is_system: false,
            send_date: "",
            mes: makeMes(botEl.value),
            extra: {},
            force_avatar: "",
          })
        );

        collectedMessageCount++;
      }
    }

    const jsonl = lines.join("\n");

    const blob = new Blob([jsonl], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = outputFileName;
    a.click();
    URL.revokeObjectURL(a.href);

    alert(`${collectedMessageCount}개 메시지 저장 완료!`);
  } finally {
    window.__rofanAiJsonlExporterRunning = false;
  }
})();
