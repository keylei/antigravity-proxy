/**
 * 网络搜索服务 - 使用 DuckDuckGo
 */

const SEARCH_TOOL_NAMES = ['search_web', 'web_search', 'search', 'google_search'];
const WEATHER_TOOL_NAMES = ['get_weather', 'weather', 'check_weather'];
const TIME_TOOL_NAMES = ['get_time', 'current_time', 'get_current_time'];

/**
 * 检查是否是搜索工具调用
 */
export function isSearchToolCall(toolCall) {
    const name = toolCall?.function?.name?.toLowerCase();
    return SEARCH_TOOL_NAMES.includes(name);
}

/**
 * 检查是否是天气工具调用
 */
export function isWeatherToolCall(toolCall) {
    const name = toolCall?.function?.name?.toLowerCase();
    return WEATHER_TOOL_NAMES.includes(name);
}

/**
 * 检查是否是时间工具调用
 */
export function isTimeToolCall(toolCall) {
    const name = toolCall?.function?.name?.toLowerCase();
    return TIME_TOOL_NAMES.includes(name);
}

/**
 * 从工具调用中提取搜索查询
 */
export function extractSearchQuery(toolCall) {
    try {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        return args.query || args.q || args.search_query || args.keyword || '';
    } catch {
        return '';
    }
}

/**
 * 从工具调用中提取城市/位置
 */
export function extractLocation(toolCall) {
    try {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        return args.city || args.location || args.place || args.timezone || 'Beijing';
    } catch {
        return 'Beijing';
    }
}

/**
 * 获取天气信息 (使用 wttr.in)
 */
export async function getWeather(location) {
    try {
        const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; WeatherBot/1.0)'
            }
        });

        if (!response.ok) {
            throw new Error(`Weather API failed: ${response.status}`);
        }

        const data = await response.json();
        const current = data.current_condition?.[0];
        const area = data.nearest_area?.[0];

        if (!current) {
            return { success: false, error: 'No weather data available' };
        }

        const weather = {
            location: area?.areaName?.[0]?.value || location,
            country: area?.country?.[0]?.value || '',
            temperature: current.temp_C,
            feelsLike: current.FeelsLikeC,
            humidity: current.humidity,
            description: current.weatherDesc?.[0]?.value || '',
            windSpeed: current.windspeedKmph,
            windDirection: current.winddir16Point,
            visibility: current.visibility,
            uvIndex: current.uvIndex,
            localTime: current.localObsDateTime || new Date().toISOString()
        };

        return { success: true, weather };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

/**
 * 格式化天气结果
 */
export function formatWeatherResult(result) {
    if (!result.success) {
        return `无法获取天气信息: ${result.error}`;
    }

    const w = result.weather;
    return `${w.location}${w.country ? ', ' + w.country : ''} 当前天气:
- 天气状况: ${w.description}
- 温度: ${w.temperature}°C (体感 ${w.feelsLike}°C)
- 湿度: ${w.humidity}%
- 风速: ${w.windSpeed} km/h (${w.windDirection})
- 能见度: ${w.visibility} km
- 紫外线指数: ${w.uvIndex}
- 观测时间: ${w.localTime}`;
}

/**
 * 获取当前时间
 */
export async function getCurrentTime(timezone) {
    // 城市名到时区的映射
    const tzMap = {
        'beijing': 'Asia/Shanghai',
        'shanghai': 'Asia/Shanghai',
        '北京': 'Asia/Shanghai',
        '上海': 'Asia/Shanghai',
        '中国': 'Asia/Shanghai',
        'china': 'Asia/Shanghai',
        'tokyo': 'Asia/Tokyo',
        '东京': 'Asia/Tokyo',
        '日本': 'Asia/Tokyo',
        'japan': 'Asia/Tokyo',
        'london': 'Europe/London',
        '伦敦': 'Europe/London',
        'new york': 'America/New_York',
        '纽约': 'America/New_York',
        'los angeles': 'America/Los_Angeles',
        '洛杉矶': 'America/Los_Angeles',
        'paris': 'Europe/Paris',
        '巴黎': 'Europe/Paris',
        'sydney': 'Australia/Sydney',
        '悉尼': 'Australia/Sydney',
        'singapore': 'Asia/Singapore',
        '新加坡': 'Asia/Singapore',
        'hong kong': 'Asia/Hong_Kong',
        '香港': 'Asia/Hong_Kong',
        'taipei': 'Asia/Taipei',
        '台北': 'Asia/Taipei',
        'seoul': 'Asia/Seoul',
        '首尔': 'Asia/Seoul',
        '韩国': 'Asia/Seoul',
        'korea': 'Asia/Seoul',
        'moscow': 'Europe/Moscow',
        '莫斯科': 'Europe/Moscow',
        'dubai': 'Asia/Dubai',
        '迪拜': 'Asia/Dubai',
        'berlin': 'Europe/Berlin',
        '柏林': 'Europe/Berlin',
        'amsterdam': 'Europe/Amsterdam',
        '阿姆斯特丹': 'Europe/Amsterdam'
    };

    try {
        // 确定时区
        let tz = 'Asia/Shanghai'; // 默认北京时间
        if (timezone && timezone !== 'local') {
            const normalizedTz = timezone.toLowerCase().trim();
            tz = tzMap[normalizedTz] || timezone.replace(' ', '_');

            // 如果不是标准时区格式，尝试添加前缀
            if (!tz.includes('/')) {
                tz = tzMap[normalizedTz] || 'Asia/Shanghai';
            }
        }

        const now = new Date();

        // 使用 Intl API 获取正确的时区时间
        const options = {
            timeZone: tz,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            weekday: 'long',
            hour12: false
        };

        let formatted;
        let tzAbbr = '';

        try {
            formatted = now.toLocaleString('zh-CN', options);
            // 获取时区缩写
            const tzOptions = { timeZone: tz, timeZoneName: 'short' };
            const tzParts = now.toLocaleString('en-US', tzOptions).split(' ');
            tzAbbr = tzParts[tzParts.length - 1];
        } catch (e) {
            // 如果时区无效，使用默认的上海时间
            tz = 'Asia/Shanghai';
            formatted = now.toLocaleString('zh-CN', { ...options, timeZone: tz });
            tzAbbr = 'CST';
        }

        // 计算 UTC 偏移
        const utcDate = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
        const tzDate = new Date(now.toLocaleString('en-US', { timeZone: tz }));
        const offsetMinutes = (tzDate - utcDate) / 60000;
        const offsetHours = Math.floor(offsetMinutes / 60);
        const offsetMins = Math.abs(offsetMinutes % 60);
        const utcOffset = `${offsetHours >= 0 ? '+' : ''}${offsetHours}:${offsetMins.toString().padStart(2, '0')}`;

        return {
            success: true,
            time: {
                datetime: now.toISOString(),
                timezone: tz,
                abbreviation: tzAbbr,
                utcOffset: utcOffset,
                formatted: formatted
            }
        };
    } catch (error) {
        // 返回服务器时间作为后备（使用北京时间）
        const now = new Date();
        return {
            success: true,
            time: {
                datetime: now.toISOString(),
                timezone: 'Asia/Shanghai',
                formatted: now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
            }
        };
    }
}

/**
 * 格式化时间结果
 */
export function formatTimeResult(result) {
    if (!result.success) {
        return `无法获取时间: ${result.error}`;
    }

    const t = result.time;
    return `当前时间 (${t.timezone}${t.abbreviation ? ' ' + t.abbreviation : ''}):
${t.formatted}
UTC偏移: ${t.utcOffset || 'N/A'}`;
}

/**
 * 执行网络搜索 - 使用多个搜索源
 */
export async function searchWeb(query, maxResults = 5) {
    if (!query) {
        return { success: false, error: 'Empty query', results: [] };
    }

    // 依次尝试多个搜索源
    const searchMethods = [
        () => searchWithGoogleNewsRss(query, maxResults),
        () => searchWithDuckDuckGoAPI(query, maxResults),
        () => searchWithWikipedia(query, maxResults)
    ];

    for (const searchMethod of searchMethods) {
        try {
            const result = await searchMethod();
            if (result.success && result.results.length > 0) {
                return result;
            }
        } catch (error) {
            // ignore
        }
    }

    return {
        success: false,
        error: 'All search methods failed',
        query,
        results: []
    };
}

/**
 * Google News RSS（无需 API key，适合新闻类查询）
 */
async function searchWithGoogleNewsRss(query, maxResults) {
    // 备注：News RSS 会自动聚合多来源；这里固定用 US 英文源保证可用性
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WebSearchBot/1.0)',
            'Accept': 'application/rss+xml, application/xml, text/xml'
        }
    });

    if (!response.ok) {
        throw new Error(`Google News RSS failed: ${response.status}`);
    }

    const xml = await response.text();
    const results = [];

    // 非严格 XML 解析：提取 <item>...</item>
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null && results.length < maxResults) {
        const item = match[1];
        const title = cleanHtml((item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] || item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
        const link = cleanHtml((item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || '').trim());
        const descRaw = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)?.[1] || item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '';
        const snippet = cleanHtml(descRaw);

        if (!link) continue;
        results.push({ title: title || link, url: link, snippet });
    }

    return {
        success: results.length > 0,
        query,
        results,
        resultCount: results.length
    };
}

/**
 * DuckDuckGo Instant Answer API
 */
async function searchWithDuckDuckGoAPI(query, maxResults) {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WebSearchBot/1.0)'
        }
    });

    if (!response.ok) {
        throw new Error(`DuckDuckGo API failed: ${response.status}`);
    }

    const data = await response.json();
    const results = [];

    // 提取 Abstract
    if (data.Abstract) {
        results.push({
            title: data.Heading || query,
            url: data.AbstractURL || '',
            snippet: data.Abstract
        });
    }

    // 提取相关主题
    if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, maxResults - results.length)) {
            if (topic.Text && topic.FirstURL) {
                results.push({
                    title: topic.Text.split(' - ')[0] || topic.Text.substring(0, 50),
                    url: topic.FirstURL,
                    snippet: topic.Text
                });
            }
        }
    }

    // 提取 Infobox
    if (data.Infobox?.content) {
        const infoItems = data.Infobox.content.slice(0, 3);
        const infoText = infoItems.map(item => `${item.label}: ${item.value}`).join('; ');
        if (infoText && results.length > 0) {
            results[0].snippet = infoText + '. ' + results[0].snippet;
        }
    }

    return {
        success: results.length > 0,
        query,
        results,
        resultCount: results.length
    };
}

/**
 * Wikipedia API 搜索
 */
async function searchWithWikipedia(query, maxResults) {
    const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${maxResults}&origin=*`;

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WebSearchBot/1.0)'
        }
    });

    if (!response.ok) {
        throw new Error(`Wikipedia API failed: ${response.status}`);
    }

    const data = await response.json();
    const results = [];

    if (data.query?.search) {
        for (const item of data.query.search) {
            results.push({
                title: item.title,
                url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
                snippet: item.snippet.replace(/<[^>]+>/g, '')
            });
        }
    }

    return {
        success: results.length > 0,
        query,
        results,
        resultCount: results.length
    };
}

/**
 * 解析 DuckDuckGo HTML 搜索结果
 */
function parseSearchResults(html, maxResults) {
    const results = [];

    // 匹配搜索结果块
    const resultRegex = /<a class="result__a" href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    let match;
    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = cleanHtml(match[2]);
        const snippet = cleanHtml(match[3]);

        // 过滤广告和无效结果
        if (url && title && !url.includes('duckduckgo.com') && !url.startsWith('/')) {
            results.push({
                title,
                url: decodeURIComponent(url.replace(/.*uddg=/, '').split('&')[0]) || url,
                snippet
            });
        }
    }

    // 备用解析方式
    if (results.length === 0) {
        const altRegex = /<div class="result[^"]*"[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/g;
        while ((match = altRegex.exec(html)) !== null && results.length < maxResults) {
            const url = match[1];
            const title = cleanHtml(match[2]);
            const snippet = cleanHtml(match[3]);

            if (url && title && !url.includes('duckduckgo.com')) {
                results.push({ title, url, snippet });
            }
        }
    }

    return results;
}

/**
 * 清理 HTML 标签和实体
 */
function cleanHtml(text) {
    if (!text) return '';
    // 注意：某些来源（如 Google News RSS description）会把 HTML 标签先实体化成 &lt;...&gt;。
    // 如果先 strip 标签再 decode 实体，会把标签“解码回来”，导致输出仍带 HTML。
    // 因此这里先 decode 常见实体，再 strip 标签。
    // 备注：先处理 &amp;，否则像 &amp;nbsp; 会在后续阶段变成 &nbsp; 而错过替换。
    const decoded = String(text)
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\u00a0/g, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        // 二次兜底：处理 &amp;nbsp; -> (&)nbsp; 的情况
        .replace(/&nbsp;/gi, ' ')
        .replace(/\u00a0/g, ' ');

    return decoded
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 格式化搜索结果为文本
 */
export function formatSearchResults(searchResult) {
    if (!searchResult.success || searchResult.results.length === 0) {
        return `搜索 "${searchResult.query}" 未找到结果。${searchResult.error ? ' 错误: ' + searchResult.error : ''}`;
    }

    let text = `搜索 "${searchResult.query}" 的结果:\n\n`;

    searchResult.results.forEach((result, index) => {
        text += `${index + 1}. ${result.title}\n`;
        text += `   链接: ${result.url}\n`;
        if (result.snippet) {
            text += `   摘要: ${result.snippet}\n`;
        }
        text += '\n';
    });

    return text;
}
