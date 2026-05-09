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

  if (window.__rofanAiJsonlExporterRunning) {
    alert("이미 실행 중입니다.");
    return;
  }

  window.__rofanAiJsonlExporterRunning = true;

  try {
    const outputFormatInput = prompt("저장 형식을 입력하세요. jsonl 또는 txt", "jsonl") || "jsonl";

    const outputFormat = outputFormatInput?.trim().toLowerCase() === "txt" ? "txt" : "jsonl";

    const excludedTagInput =
      outputFormat === "txt"
        ? prompt("내용에서 제외할 태그가 있다면 입력해주세요. 여러 개라면 띄어쓰기 없이 쉼표로 구분해주세요.", "<details>")
        : "";

    const excludedTagNames = String(excludedTagInput || "")
      .split(",")
      .map((tag) => tag.trim().replace(/^<\s*\/?\s*/, "").replace(/\s*\/?\s*>$/, "").split(/\s+/)[0])
      .filter(Boolean);

    const escapeTagName = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const removeExcludedTags = (text) =>
      excludedTagNames.reduce((currentText, tagName) => {
        const escapedTagName = escapeTagName(tagName);
        return currentText.replace(
          new RegExp(`<\\s*${escapedTagName}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${escapedTagName}\\s*>`, "gi"),
          ""
        );
      }, text);

    let shouldConvertMes = false;

    let skipConvertTexts = [];

    shouldConvertMes =
      (prompt("대사에 따옴표를 붙이고 행동 지문에서 *를 제거할까요? (예/아니오)", "예") || "아니오")
        .trim()
        .toLowerCase() !== "아니오";

    if (shouldConvertMes) {
      skipConvertTexts = (
        prompt("이 문자가 포함된 메시지는 변환하지 않습니다. 여러 개면 쉼표로 구분해주세요. 없으면 비워두세요.", "") || ""
      )
        .split(",")
        .map((text) => text.trim())
        .filter(Boolean);
    }

    function parseChatRoute(pathname = window.location.pathname) {
      const parts = pathname.split("/").filter(Boolean);

      if (parts.length === 3 && parts[1] === "chat") {
        return {
          locale: parts[0],
          id: decodeURIComponent(parts[2]),
        };
      }

      if (parts.length === 2 && parts[0] === "chat") {
        return {
          locale: "ko",
          id: decodeURIComponent(parts[1]),
        };
      }

      return null;
    }

    async function getCurrentChatProps() {
      const route = parseChatRoute();

      if (!route) {
        throw new Error("Not a chat route");
      }

      const { buildId } = window.__NEXT_DATA__;

      const url =
        `/_next/data/${buildId}/${route.locale}/chat/${route.id}.json?` +
        new URLSearchParams({ id: route.id }).toString();

      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(`Failed to fetch Next data: ${res.status}`);
      }

      const json = await res.json();
      return json.pageProps ?? json.props?.pageProps ?? json.props;
    }

    const props = await getCurrentChatProps();
    const fstMsg = props?.oriBotDetail?.first_message || "";
    const currentChatId = props?.chatId;
    const chatIndex = Number(props?.oriChatData?.chat_count) || 100;
    const characterName = props?.oriChatData?.char || "character";
    const userName = props?.oriChatData?.user || "user";

    if (!currentChatId) {
      alert("채팅 ID를 찾을 수 없습니다. 올바른 채팅 페이지인지 확인해주세요.");
      throw new Error("currentChatId 없음");
    }

    const defaultFileNameBase = getDefaultFileNameBase(characterName);

const outputFileNameBase = (
  prompt("저장할 파일명을 입력하세요. 확장자는 제외하고 입력해주세요.", defaultFileNameBase) || defaultFileNameBase
)
  .trim()
  .replace(/\.(jsonl|json|txt)+$/i, "");

const outputFileName = `${outputFileNameBase || defaultFileNameBase}.${outputFormat}`;
    function makeMes(str) {
      if (skipConvertTexts.some((text) => str.includes(text))) {
        return str;
      }

      return shouldConvertMes ? convertMes(str) : str;
    }

    const rows = [];

    let collectedMessageCount = 0;

    if (fstMsg.trim()) {
      rows.push({
        name: characterName,
        is_user: false,
        is_system: false,
        send_date: "",
        mes: makeMes(fstMsg),
        extra: {},
        force_avatar: "",
      });

      collectedMessageCount++;
    }

    const response = await fetch("https://rofan.ai/api/chat/GetChatLogs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chatId: currentChatId,
        limit: chatIndex,
        offset: 0,
      }),
    });

    if (!response.ok) {
      throw new Error(`채팅 로그 요청 실패: ${response.status}`);
    }

    const data = await response.json();
    console.log("[RofanAI Chat Logs]", data);

    const chatLogs = Array.isArray(data) ? data : [];

    for (const item of chatLogs) {
      if (item?.user_chat) {
        rows.push({
          name: userName,
          is_user: true,
          is_system: false,
          send_date: item.created || "",
          mes: makeMes(item.user_chat),
          extra: {},
          force_avatar: "",
        });

        collectedMessageCount++;
      }

      if (item?.bot_chat) {
        rows.push({
          name: characterName,
          is_user: false,
          is_system: false,
          send_date: item.created || "",
          mes: makeMes(item.bot_chat),
          extra: {
            model: item.model || "",
          },
          force_avatar: "",
        });

        collectedMessageCount++;
      }
    }

    const outputText =
      outputFormat === "txt"
        ? rows.map((row) => removeExcludedTags(row.mes).trim()).filter(Boolean).join("\n\n")
        : [JSON.stringify({ chat_metadata: {} }), ...rows.map((row) => JSON.stringify(row))].join("\n");

    const blob = new Blob([outputText]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = outputFileName;
    a.click();
    URL.revokeObjectURL(a.href);

    alert(`${collectedMessageCount}개 메시지 저장 완료!`);
  } catch (error) {
    console.error("요청 실패:", error);
    alert(`오류 발생: ${error?.message || error}`);
    throw error;
  } finally {
    window.__rofanAiJsonlExporterRunning = false;
  }
})();
