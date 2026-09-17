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

  function sanitizeFileName(name) {
    return String(name || "character")
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim() || "character";
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

  function makeCharacterCardFromProps(props) {
    const bot = props?.oriBotDetail || {};
    const chatData = props?.oriChatData || {};

    const name = bot.char || chatData.char || "character";
    const imageUrl = bot.char_image || "";
    const botId = chatData.bot_id || "";

    const botUrl = botId
      ? `https://rofan.ai/character/${botId}`
      : location.href;

    const description = [
      bot.char_persona || "",
      bot.worldview || bot.world_view || "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: {
        name,
        description,
        personality: "",
        scenario: "",
        first_mes: bot.first_message || "",
        mes_example: "",

        creator_notes:
          `<a href="${botUrl}">${name}</a>\n\n${bot.creator_message || ""}`,

        system_prompt: "",
        post_history_instructions: "",
        alternate_greetings: [],
        tags: [],

        creator: "rofan.ai",
        character_version: "1.0",

        extensions: {
          rofan_ai: {
            bot_id: botId,
            char_image: imageUrl,
            source: botUrl,
            chat_source: location.href,
          },
        },
      },
    };
  }

  function downloadTextFile(text, fileName, type) {
    const blob = new Blob([text], { type });

    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }

  function downloadJsonFile(object, fileName) {
    downloadTextFile(
      JSON.stringify(object, null, 2),
      fileName,
      "application/json;charset=utf-8"
    );
  }

  function randomDelay(minMs, maxMs) {
    const ms = minMs + Math.random() * (maxMs - minMs);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchAllEpisodes(chatId) {
    const episodes = [];
    const limit = 20;
    let offset = 0;

    while (true) {
      const response = await fetch(
        "https://rofan.ai/api/chat/episode/GetEpisodes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ chatId, offset, limit, sort: "oldest" }),
        }
      );

      if (!response.ok) {
        throw new Error(`에피소드 요약 요청 실패: ${response.status}`);
      }

      const data = await response.json();
      episodes.push(...(data?.episodes || []));

      if (!data?.hasMore) break;
      offset += limit;

      await randomDelay(300, 900);
    }

    return episodes;
  }

  async function fetchAllChatLogs(chatId, limit = 20) {
    const pageList = [];
    const seenKeys = new Set();
    let beforeTimestamp = undefined;
    let previousCursor = undefined;

    while (true) {
      const body = { chatId, limit };
      if (beforeTimestamp) body.beforeTimestamp = beforeTimestamp;

      const response = await fetch("https://rofan.ai/api/chat/GetChatLogs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`채팅 로그 요청 실패: ${response.status}`);
      }

      const data = await response.json();
      const page = Array.isArray(data) ? data : data?.logs || [];

      if (!page.length) break;

      // 같은 구간이 겹쳐 다시 오더라도 중복은 걸러냄 (커서 방향 오판 방지용 안전장치)
      const uniquePage = page.filter((item) => {
        const key = `${item.created}|${item.user_chat || ""}|${item.bot_chat || ""}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

      pageList.push(uniquePage);

      if (page.length < limit) break;

      // 페이지는 오래된→최신 순으로 오므로, 다음 커서는 이 페이지의 가장 오래된(첫) 항목
      const oldestInPage = page[0]?.created;
      if (!oldestInPage || oldestInPage === previousCursor) break;

      previousCursor = oldestInPage;
      beforeTimestamp = oldestInPage;

      await randomDelay(300, 900);
    }

    // 페이지 자체는 최신 구간부터 수집되므로 페이지 순서만 뒤집고, 페이지 내부(오래된→최신) 순서는 유지
    return pageList.reverse().flat();
  }

  function makeSummaryWorldInfoEntry(episodes) {
    const body = episodes
      .filter((ep) => ep?.title || ep?.summary)
      .map((ep) => `- ${ep.title}:\n${ep.summary}`)
      .join("\n\n");

    if (!body) return null;

    return {
      id: 0,
      keys: [],
      secondary_keys: [],
      comment: "이전 에피소드 요약",
      content: `<summary>\n${body}\n</summary>`,
      constant: true,
      selective: false,
      insertion_order: 0,
      enabled: true,
      position: "before_char",
      extensions: {},
    };
  }

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function crc32(bytes) {
    if (!crc32.table) {
      const table = [];
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
          c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
      }
      crc32.table = table;
    }

    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = crc32.table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function parsePngChunks(bytes) {
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      if (bytes[i] !== PNG_SIGNATURE[i]) {
        throw new Error("PNG 시그니처가 아닙니다.");
      }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks = [];
    let offset = PNG_SIGNATURE.length;

    while (offset < bytes.length) {
      const length = view.getUint32(offset, false);
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );
      const dataStart = offset + 8;
      const data = bytes.slice(dataStart, dataStart + length);

      chunks.push({ type, data });
      offset = dataStart + length + 4;
    }

    return chunks;
  }

  function buildPngChunk(type, data) {
    const typeBytes = new Uint8Array(4);
    for (let i = 0; i < 4; i++) {
      typeBytes[i] = type.charCodeAt(i);
    }

    const typeAndData = new Uint8Array(typeBytes.length + data.length);
    typeAndData.set(typeBytes, 0);
    typeAndData.set(data, typeBytes.length);

    const chunk = new Uint8Array(4 + typeAndData.length + 4);
    new DataView(chunk.buffer).setUint32(0, data.length, false);
    chunk.set(typeAndData, 4);
    new DataView(chunk.buffer).setUint32(4 + typeAndData.length, crc32(typeAndData), false);

    return chunk;
  }

  function encodePngChunks(chunks) {
    const parts = [new Uint8Array(PNG_SIGNATURE), ...chunks.map((c) => buildPngChunk(c.type, c.data))];
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(totalLength);

    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }

    return out;
  }

  function uint8ArrayToBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary);
  }

  function makeTextChunkData(keyword, text) {
    const keywordBytes = new TextEncoder().encode(keyword);
    const textBytes = new TextEncoder().encode(text);
    const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length);

    data.set(keywordBytes, 0);
    data[keywordBytes.length] = 0;
    data.set(textBytes, keywordBytes.length + 1);

    return data;
  }

  function embedCharacterCardIntoPng(pngBytes, card) {
    const chunks = parsePngChunks(pngBytes).filter((chunk) => {
      if (chunk.type !== "tEXt") return true;

      const nullIndex = chunk.data.indexOf(0);
      const keyword = new TextDecoder().decode(chunk.data.slice(0, nullIndex));

      return keyword !== "chara";
    });

    const base64Data = uint8ArrayToBase64(new TextEncoder().encode(JSON.stringify(card)));
    const charaChunk = { type: "tEXt", data: makeTextChunkData("chara", base64Data) };

    const iendIndex = chunks.findIndex((chunk) => chunk.type === "IEND");
    chunks.splice(iendIndex === -1 ? chunks.length : iendIndex, 0, charaChunk);

    return encodePngChunks(chunks);
  }

  function corsProxyUrl(imageUrl) {
    return `https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}`;
  }

  async function fetchImageBlob(imageUrl) {
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`캐릭터 이미지 요청 실패: ${response.status}`);
      }
      return await response.blob();
    } catch (directError) {
      try {
        const response = await fetch(corsProxyUrl(imageUrl));
        if (!response.ok) {
          throw new Error(`프록시 경유 이미지 요청 실패: ${response.status}`);
        }
        return await response.blob();
      } catch (proxyError) {
        throw new Error(
          `이미지 요청 실패(CORS 차단 가능성, 프록시도 실패): ${
            proxyError?.message || proxyError
          }`
        );
      }
    }
  }

  async function fetchImageAsPngBytes(imageUrl) {
    const blob = await fetchImageBlob(imageUrl);

    let bitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch (error) {
      throw new Error(`이미지 디코딩 실패: ${error?.message || error}`);
    }

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);

    const pngBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error("캔버스 PNG 변환 실패(CORS로 캔버스 오염 가능성)")),
        "image/png"
      );
    });

    return new Uint8Array(await pngBlob.arrayBuffer());
  }

  function downloadUrlDirectly(url, fileName) {
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function downloadBlobFile(blob, fileName) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      URL.revokeObjectURL(a.href);
    }, 1000);
  }

  if (window.__rofanAiJsonlExporterRunning) {
    alert("이미 실행 중입니다.");
    return;
  }

  window.__rofanAiJsonlExporterRunning = true;

  try {
    const outputFormatInput =
      prompt("저장 형식을 입력하세요. jsonl 또는 txt", "jsonl") || "jsonl";

    const outputFormat =
      outputFormatInput.trim().toLowerCase() === "txt" ? "txt" : "jsonl";

    const excludedTagInput =
      outputFormat === "txt"
        ? prompt(
            "내용에서 제외할 태그가 있다면 입력해주세요. 여러 개라면 띄어쓰기 없이 쉼표로 구분해주세요.",
            "<details>"
          )
        : "";

    const excludedTagNames = String(excludedTagInput || "")
      .split(",")
      .map((tag) =>
        tag
          .trim()
          .replace(/^<\s*\/?\s*/, "")
          .replace(/\s*\/?\s*>$/, "")
          .split(/\s+/)[0]
      )
      .filter(Boolean);

    const escapeTagName = (value) =>
      value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const removeExcludedTags = (text) =>
      excludedTagNames.reduce((currentText, tagName) => {
        const escapedTagName = escapeTagName(tagName);

        return currentText.replace(
          new RegExp(
            `<\\s*${escapedTagName}\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*${escapedTagName}\\s*>`,
            "gi"
          ),
          ""
        );
      }, text);

    const shouldConvertMes =
      (
        prompt(
          "대사에 따옴표를 붙이고 행동 지문에서 *를 제거할까요? (예/아니오)",
          "예"
        ) || "아니오"
      )
        .trim()
        .toLowerCase() !== "아니오";

    const skipConvertTexts = shouldConvertMes
      ? (
          prompt(
            "이 문자가 포함된 메시지는 변환하지 않습니다. 여러 개면 쉼표로 구분해주세요. 없으면 비워두세요.",
            ""
          ) || ""
        )
          .split(",")
          .map((text) => text.trim())
          .filter(Boolean)
      : [];

    function makeMes(str) {
      if (skipConvertTexts.some((text) => str.includes(text))) {
        return str;
      }

      return shouldConvertMes ? convertMes(str) : str;
    }

    const props = await getCurrentChatProps();

    const fstMsg = props?.oriBotDetail?.first_message || "";
    const currentChatId = props?.chatId;
    const chatCount = Number(props?.oriChatData?.chat_count) || 0;
    const characterName =
      props?.oriChatData?.char ||
      props?.oriBotDetail?.char ||
      "character";
    const userName = props?.oriChatData?.user || "user";

    if (!currentChatId) {
      alert("채팅 ID를 찾을 수 없습니다. 올바른 채팅 페이지인지 확인해주세요.");
      throw new Error("currentChatId 없음");
    }

    const defaultFileNameBase = getDefaultFileNameBase(characterName);

    const outputFileNameBase = (
      prompt(
        "저장할 파일명을 입력하세요. 확장자는 제외하고 입력해주세요.",
        defaultFileNameBase
      ) || defaultFileNameBase
    )
      .trim()
      .replace(/\.(jsonl|json|txt)+$/i, "");

    const safeBaseName = sanitizeFileName(outputFileNameBase || defaultFileNameBase);

    const chatFileName = `${safeBaseName}.${outputFormat}`;
    const cardFileName = `${safeBaseName}_character.json`;

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

    const estimatedPages = Math.max(1, Math.ceil(chatCount / 20));
    const estimatedMinutes = Math.max(1, Math.ceil((estimatedPages * 1.1) / 60));

    alert(
      `총 메시지 ${chatCount}개 확인.\n` +
      `약 ${estimatedMinutes}분 이상 걸려요. 완료 메시지가 뜰 때까지 이 창에서 기다려주세요.`
    );

    const chatLogs = await fetchAllChatLogs(currentChatId, 20);
    console.log("[RofanAI Chat Logs]", chatLogs);

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

    const chatOutputText =
      outputFormat === "txt"
        ? rows
            .map((row) => removeExcludedTags(row.mes).trim())
            .filter(Boolean)
            .join("\n\n")
        : [
            JSON.stringify({ chat_metadata: {} }),
            ...rows.map((row) => JSON.stringify(row)),
          ].join("\n");

    const episodes = await fetchAllEpisodes(currentChatId);
    console.log("[RofanAI Episodes]", episodes);

    const summaryWorldInfoEntry = makeSummaryWorldInfoEntry(episodes);

    const card = makeCharacterCardFromProps(props);

    if (summaryWorldInfoEntry) {
      card.data.character_book = {
        name: `${characterName} 요약 로어북`,
        entries: [summaryWorldInfoEntry],
      };
    }

    const charImageUrl = props?.oriBotDetail?.char_image || "";
    let cardPngBlob = null;

    if (charImageUrl) {
      try {
        const pngBytes = await fetchImageAsPngBytes(charImageUrl);
        cardPngBlob = new Blob([embedCharacterCardIntoPng(pngBytes, card)], {
          type: "image/png",
        });
      } catch (error) {
        const detail = error?.message || String(error);
        console.error("캐릭터 카드 PNG 생성 실패:", detail);

        const imageExt = (charImageUrl.split(".").pop() || "webp").split("?")[0];
        downloadUrlDirectly(charImageUrl, `${safeBaseName}_image.${imageExt}`);

        alert(
          `캐릭터 카드 PNG 생성 실패, JSON + 원본 이미지 파일로 저장합니다.\n${detail}`
        );
      }
    }

    const cardOutputFileName = cardPngBlob
      ? `${safeBaseName}_character.png`
      : cardFileName;

    downloadTextFile(
      chatOutputText,
      chatFileName,
      outputFormat === "txt"
        ? "text/plain;charset=utf-8"
        : "application/octet-stream"
    );

    setTimeout(() => {
      if (cardPngBlob) {
        downloadBlobFile(cardPngBlob, cardOutputFileName);
      } else {
        downloadJsonFile(card, cardOutputFileName);
      }
    }, 500);

    console.log("채팅 저장 완료:", chatFileName);
    console.log("캐릭터 카드 저장 완료:", cardOutputFileName, card);

    alert(
      `${collectedMessageCount}개 메시지 저장 완료!\n` +
      `채팅 파일: ${chatFileName}\n` +
      `캐릭터 카드: ${cardOutputFileName}`
    );
  } catch (error) {
    console.error("요청 실패:", error);
    alert(`오류 발생: ${error?.message || error}`);
    throw error;
  } finally {
    window.__rofanAiJsonlExporterRunning = false;
  }
})();
