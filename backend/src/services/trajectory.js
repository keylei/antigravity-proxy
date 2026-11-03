/**
 * Trajectory Analytics 上报
 * 在每次成功 API 响应后向上游发送伪造的使用轨迹数据，
 * 模拟真实 Antigravity 客户端的行为。
 *
 * 参考：antigravity2api-nodejs/src/utils/trajectory.js
 */
import crypto from 'crypto';
import { ANTIGRAVITY_CONFIG, getAgVersion } from '../config.js';
import { fingerprintFetch } from '../runtime/fingerprint-requester.js';
import { QA_PAIRS } from '../constants/qaPairs.js';

const BASE_URL = ANTIGRAVITY_CONFIG.base_url;
const API_HOST = new URL(BASE_URL).host;

// 模块级持久 deviceId（与 antigravity2api 一致，模块加载时生成一次）
let deviceId = crypto.randomUUID();

// ==================== Model Placeholder 映射 ====================

const MODEL_PLACEHOLDERS = {
    'gemini-3.1-pro-high': 'MODEL_PLACEHOLDER_M37',
    'gemini-3.1-pro-low': 'MODEL_PLACEHOLDER_M36',
    'gemini-3-pro-high': 'MODEL_PLACEHOLDER_M8',
    'gemini-3-pro-low': 'MODEL_PLACEHOLDER_M7',
    'gemini-3-flash': 'MODEL_PLACEHOLDER_M18',
    'claude-opus-4-6-thinking': 'MODEL_PLACEHOLDER_M26',
    'claude-sonnet-4-6': 'MODEL_PLACEHOLDER_M35',
    'gpt-oss-120b-medium': 'MODEL_OPENAI_GPT_OSS_120B_MEDIUM',
    'gemini-2.5-pro': 'MODEL_GOOGLE_GEMINI_2_5_PRO',
    'gemini-2.5-flash': 'MODEL_GOOGLE_GEMINI_2_5_FLASH',
    'gemini-2.5-flash-thinking': 'MODEL_GOOGLE_GEMINI_2_5_FLASH_THINKING',
    'gemini-2.5-flash-lite': 'MODEL_GOOGLE_GEMINI_2_5_FLASH_LITE',
};

const MODEL_API_PROVIDERS = {
    'gemini-3.1-pro-high': 'API_PROVIDER_GOOGLE_GEMINI',
    'gemini-3.1-pro-low': 'API_PROVIDER_GOOGLE_GEMINI',
    'gemini-3-pro-high': 'API_PROVIDER_GOOGLE_GEMINI',
    'gemini-3-pro-low': 'API_PROVIDER_GOOGLE_GEMINI',
    'gemini-3-flash': 'API_PROVIDER_GOOGLE_GEMINI',
    'claude-opus-4-6-thinking': 'API_PROVIDER_ANTHROPIC_VERTEX',
    'claude-sonnet-4-6': 'API_PROVIDER_ANTHROPIC_VERTEX',
    'gpt-oss-120b-medium': 'API_PROVIDER_OPENAI_VERTEX',
    'gemini-2.5-pro': 'API_PROVIDER_GOOGLE_GEMINI',
    'gemini-2.5-flash': 'API_PROVIDER_GOOGLE_GEMINI',
    'gemini-2.5-flash-thinking': 'API_PROVIDER_GOOGLE_GEMINI',
    'gemini-2.5-flash-lite': 'API_PROVIDER_GOOGLE_GEMINI',
};

const DEFAULT_MODEL = 'gemini-3.1-pro-high';

function getModelPlaceholder(model) {
    if (!model) return MODEL_PLACEHOLDERS[DEFAULT_MODEL];
    return MODEL_PLACEHOLDERS[model] || MODEL_PLACEHOLDERS[DEFAULT_MODEL];
}

function getApiProvider(model) {
    if (!model) return MODEL_API_PROVIDERS[DEFAULT_MODEL];
    return MODEL_API_PROVIDERS[model] || MODEL_API_PROVIDERS[DEFAULT_MODEL];
}

// ==================== 工具列表（真实客户端 22 个工具） ====================

const TOOL_DEFS = [
    'browser_subagent', 'command_status', 'find_by_name', 'generate_image',
    'grep_search', 'list_dir', 'list_resources', 'multi_replace_file_content',
    'notify_user', 'read_resource', 'read_terminal', 'read_url_content',
    'replace_file_content', 'run_command', 'search_web', 'send_command_input',
    'task_boundary', 'view_code_item', 'view_content_chunk', 'view_file',
    'view_file_outline', 'write_to_file'
].map(name => ({
    name,
    description: name.replace(/_/g, ' '),
    jsonSchemaString: JSON.stringify({
        '$schema': 'https://json-schema.org/draft/2020-12/schema',
        type: 'object', properties: {}, additionalProperties: false
    })
}));

// ==================== Helpers ====================

// 构造精确到纳秒的 ISO 时间戳（模拟 Go time.Now()）
function generateNanoTimestamp() {
    const now = new Date();
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    const nanoSuffix = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    return now.toISOString().replace(/\.\d{3}Z$/, `.${ms}${nanoSuffix}Z`);
}

function generateDuration(minSec, maxSec) {
    const sec = minSec + Math.random() * (maxSec - minSec);
    return sec.toFixed(9) + 's';
}

function randomQAPair() {
    return QA_PAIRS[Math.floor(Math.random() * QA_PAIRS.length)];
}

// ==================== Top-level metadata ====================

function generateMetadata(account) {
    return {
        deviceFingerprint: account.device_fingerprint || deviceId,
        extensionName: 'antigravity',
        extensionPath: 'd:\\Antigravity\\Antigravity\\resources\\app\\extensions\\antigravity',
        hardware: 'amd64',
        ideName: 'antigravity',
        ideVersion: getAgVersion(),
        locale: 'en',
        os: 'windows',
        regionCode: 'US',
        userTierId: account.tier || 'g1-pro-tier'
    };
}

// ==================== Generator Metadata ====================

function buildGeneratorMetadata(qa, executionId, model) {
    const modelPlaceholder = getModelPlaceholder(model);
    const apiProvider = getApiProvider(model);
    const createdAt = generateNanoTimestamp();
    const traceId = crypto.randomBytes(8).toString('hex');
    const responseId = crypto.randomBytes(15).toString('base64url');
    const sessionID = String(-Math.floor(1e18 + Math.random() * 9e18));
    const cacheReadTokens = String(10000 + Math.floor(Math.random() * 10000));
    const inputTokens = String(3000 + Math.floor(Math.random() * 5000));
    const outputTokens = String(100 + Math.floor(Math.random() * 400));
    const responseOutputTokens = String(20 + Math.floor(Math.random() * 80));
    const thinkingOutputTokens = String(50 + Math.floor(Math.random() * 250));
    const conversationId = crypto.randomUUID();

    const usage = {
        apiProvider,
        cacheReadTokens,
        inputTokens,
        model: modelPlaceholder,
        outputTokens,
        responseHeader: { sessionID },
        responseId,
        responseOutputTokens,
        thinkingOutputTokens
    };

    return [{
        chatModel: {
            // chatStartMetadata 只含基础元信息
            chatStartMetadata: {
                cacheBreakpoints: [{
                    contentChecksum: crypto.randomBytes(4).toString('hex'),
                    index: 1,
                    options: { type: 'CACHE_CONTROL_TYPE_EPHEMERAL' }
                }],
                checkpointIndex: -1,
                contextWindowMetadata: {
                    estimatedTokensUsed: 2500 + Math.floor(Math.random() * 2000)
                },
                createdAt,
                latestStableMessageIndex: 1,
                systemPromptCache: {
                    contentChecksum: crypto.randomBytes(4).toString('hex'),
                    options: { type: 'CACHE_CONTROL_TYPE_EPHEMERAL' }
                },
                timeSinceLastInvocation: '0s'
            },
            // 以下字段与 chatStartMetadata 同级（非嵌套）
            completionConfig: {
                fimEotProbThreshold: 1,
                firstTemperature: 0.4,
                maxNewlines: '200',
                maxTokens: '16384',
                numCompletions: '1',
                stopPatterns: ['<|user|>', '<|bot|>', '<|context_request|>', '<|endoftext|>', '<|end_of_turn|>'],
                temperature: 1,
                topK: '50',
                topP: 1
            },
            lastCacheIndex: 1,
            messageMetadata: [
                {},
                { messageIndex: 1 },
                { messageIndex: 2 },
                { messageIndex: 3 },
                { messageIndex: 4 },
                { messageIndex: 5 },
                { messageIndex: 6 },
                { messageIndex: 6, segmentIndex: 1 }
            ],
            messagePrompts: [
                {
                    prompt: '<user_information>\nThe USER\'s OS version is windows.\nThe user has 1 active workspaces, each defined by a URI and a CorpusName.\nd:\\projects\\myapp -> user/myapp\n</user_information>',
                    source: 'CHAT_MESSAGE_SOURCE_USER'
                },
                {
                    prompt: `<artifact_formatting_guidelines>\nArtifact Directory Path: C:\\Users\\user\\.gemini\\antigravity\\brain\\${conversationId}\n</artifact_formatting_guidelines>`,
                    promptCacheOptions: { type: 'CACHE_CONTROL_TYPE_EPHEMERAL' },
                    source: 'CHAT_MESSAGE_SOURCE_USER'
                },
                {
                    prompt: '<user_rules>\nThe user has not defined any custom rules.\n</user_rules>',
                    source: 'CHAT_MESSAGE_SOURCE_USER'
                },
                {
                    prompt: '<workflows>\nYou have the ability to use and create workflows.\n</workflows>',
                    source: 'CHAT_MESSAGE_SOURCE_USER'
                },
                {
                    numTokens: 100 + Math.floor(Math.random() * 50),
                    prompt: `Step Id: 0\n\n<USER_REQUEST>\n${qa.question}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe current local time is: ${new Date().toISOString().replace('Z', '+08:00')}.\n</ADDITIONAL_METADATA>`,
                    safeForCodeTelemetry: true,
                    source: 'CHAT_MESSAGE_SOURCE_USER'
                },
                {
                    numTokens: 2000 + Math.floor(Math.random() * 500),
                    prompt: 'Step Id: 1\n# Conversation History\nNo previous conversations.',
                    source: 'CHAT_MESSAGE_SOURCE_USER',
                    stepIdx: 1
                },
                {
                    numTokens: 800 + Math.floor(Math.random() * 200),
                    prompt: 'Step Id: 3\nThe following is an <EPHEMERAL_MESSAGE>.\n<EPHEMERAL_MESSAGE>\n<no_active_task_reminder>\nYou are currently not in a task.\n</no_active_task_reminder>\n</EPHEMERAL_MESSAGE>',
                    source: 'CHAT_MESSAGE_SOURCE_USER',
                    stepIdx: 3
                },
                {
                    prompt: qa.answer,
                    source: 'CHAT_MESSAGE_SOURCE_SYSTEM',
                    stepIdx: 4,
                    thinking: '**Processing Request**\n\nAnalyzing the user\'s question and formulating a response.\n\n',
                    thinkingSignature: crypto.randomBytes(512).toString('base64')
                }
            ],
            model: modelPlaceholder,
            promptSections: [
                {
                    content: '<identity>\nYou are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task.\n</identity>',
                    metadata: { sourceType: 'PROMPT_SECTION_SOURCE_TYPE_TEMPLATE', templateKey: 'identity' },
                    title: 'identity'
                },
                {
                    dynamicContent: '<user_information>\nThe USER\'s OS version is windows.\n</user_information>',
                    title: 'user_information'
                },
                {
                    content: '<agentic_mode_overview>\nYou are in AGENTIC mode.\n</agentic_mode_overview>',
                    metadata: { sourceType: 'PROMPT_SECTION_SOURCE_TYPE_TEMPLATE', templateKey: 'agentic_mode_overview' },
                    title: 'agentic_mode_overview'
                },
                {
                    content: '<communication_style>\nFormat your responses in github-style markdown.\n</communication_style>',
                    metadata: { sourceType: 'PROMPT_SECTION_SOURCE_TYPE_TEMPLATE', templateKey: 'communication_style' },
                    title: 'communication_style'
                }
            ],
            retryInfos: [{ traceId, usage }],
            streamingDuration: generateDuration(1, 4),
            systemPrompt: '<identity>\nYou are Antigravity, a powerful agentic AI coding assistant designed by the Google Deepmind team working on Advanced Agentic Coding.\nYou are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.\nThe USER will send you requests, which you must always prioritize addressing.\n</identity>\n<agentic_mode_overview>\nYou are in AGENTIC mode.\n</agentic_mode_overview>\n<communication_style>\nFormat your responses in github-style markdown.\n</communication_style>',
            timeToFirstToken: generateDuration(3, 6),
            toolChoice: { optionName: 'auto' },
            tools: TOOL_DEFS,
            usage
        },
        executionId,
        plannerConfig: {
            agenticModeConfig: { disableArtifactReminders: false },
            conversational: { agenticMode: true, plannerMode: 'CONVERSATIONAL_PLANNER_MODE_DEFAULT' },
            ephemeralMessagesConfig: { enabled: true, persistenceLevel: 'EPHEMERAL_MESSAGE_PERSISTENCE_LEVEL_LATEST_ONLY' },
            knowledgeConfig: { enabled: true },
            maxOutputTokens: 16384,
            modelName: model || DEFAULT_MODEL,
            planModel: modelPlaceholder,
            requestedModel: { model: modelPlaceholder },
            retryConfig: {
                apiRetry: { exponentialMultiplier: 2, includeErrorFeedback: true, initialSleepDurationMs: 5000, maxRetries: 2, range: 0.4 },
                modelOutputRetry: { forceToolName: 'notify_user', maxRetries: 4 }
            },
            toolConfig: {
                code: { applyEdits: true },
                runCommand: { enableIdeTerminalExecution: true },
                notifyUser: { artifactReviewMode: 'ARTIFACT_REVIEW_MODE_ALWAYS' }
            },
            truncationThresholdTokens: 160000
        },
        stepIndices: [4]
    }];
}

// ==================== Steps ====================

function buildSteps(executionId, trajectoryId, cascadeId, qa, modelPlaceholder) {
    return [
        // Step 0: user input
        {
            metadata: {
                createdAt: generateNanoTimestamp(),
                executionId,
                internalMetadata: {
                    statusTransitions: [{ timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_DONE' }]
                },
                source: 'CORTEX_STEP_SOURCE_USER_EXPLICIT',
                sourceTrajectoryStepInfo: { cascadeId, trajectoryId }
            },
            status: 'CORTEX_STEP_STATUS_DONE',
            type: 'CORTEX_STEP_TYPE_USER_INPUT',
            userInput: {
                activeUserState: {},
                clientType: 'CHAT_CLIENT_REQUEST_STREAM_CLIENT_TYPE_IDE',
                items: [{ text: qa.question }],
                userConfig: {
                    conversationHistoryConfig: { enabled: true },
                    plannerConfig: {
                        conversational: { agenticMode: true, plannerMode: 'CONVERSATIONAL_PLANNER_MODE_DEFAULT' },
                        ephemeralMessagesConfig: { enabled: true },
                        knowledgeConfig: { enabled: true },
                        requestedModel: { model: modelPlaceholder },
                        toolConfig: {
                            notifyUser: { artifactReviewMode: 'ARTIFACT_REVIEW_MODE_ALWAYS' },
                            runCommand: { autoCommandConfig: { autoExecutionPolicy: 'CASCADE_COMMANDS_AUTO_EXECUTION_OFF' } }
                        }
                    }
                },
                userResponse: qa.question
            }
        },
        // Step 1: conversation history
        {
            conversationHistory: { content: '' },
            metadata: {
                completedAt: generateNanoTimestamp(),
                createdAt: generateNanoTimestamp(),
                executionId,
                internalMetadata: {
                    statusTransitions: [
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_PENDING' },
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_RUNNING' },
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_DONE' }
                    ]
                },
                source: 'CORTEX_STEP_SOURCE_SYSTEM',
                sourceTrajectoryStepInfo: { cascadeId, stepIndex: 1, trajectoryId }
            },
            status: 'CORTEX_STEP_STATUS_DONE',
            type: 'CORTEX_STEP_TYPE_CONVERSATION_HISTORY'
        },
        // Step 2: knowledge artifacts
        {
            knowledgeArtifacts: {},
            metadata: {
                completedAt: generateNanoTimestamp(),
                createdAt: generateNanoTimestamp(),
                executionId,
                internalMetadata: {
                    statusTransitions: [
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_PENDING' },
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_RUNNING' },
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_DONE' }
                    ]
                },
                source: 'CORTEX_STEP_SOURCE_SYSTEM',
                sourceTrajectoryStepInfo: { cascadeId, stepIndex: 2, trajectoryId }
            },
            status: 'CORTEX_STEP_STATUS_DONE',
            type: 'CORTEX_STEP_TYPE_KNOWLEDGE_ARTIFACTS'
        },
        // Step 3: ephemeral message
        {
            ephemeralMessage: {
                content: '',
                triggeredHeuristics: ['bash_command_reminder', 'artifact_reminder', 'no_active_task_reminder']
            },
            metadata: {
                completedAt: generateNanoTimestamp(),
                createdAt: generateNanoTimestamp(),
                executionId,
                internalMetadata: {
                    statusTransitions: [
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_PENDING' },
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_RUNNING' },
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_DONE' }
                    ]
                },
                source: 'CORTEX_STEP_SOURCE_SYSTEM',
                sourceTrajectoryStepInfo: { cascadeId, stepIndex: 3, trajectoryId }
            },
            status: 'CORTEX_STEP_STATUS_DONE',
            type: 'CORTEX_STEP_TYPE_EPHEMERAL_MESSAGE'
        },
        // Step 4: planner response
        {
            metadata: {
                completedAt: generateNanoTimestamp(),
                createdAt: generateNanoTimestamp(),
                executionId,
                finishedGeneratingAt: generateNanoTimestamp(),
                generatorModel: modelPlaceholder,
                internalMetadata: {
                    statusTransitions: [
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_GENERATING' },
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_DONE' }
                    ]
                },
                requestedModel: { model: modelPlaceholder },
                source: 'CORTEX_STEP_SOURCE_MODEL',
                sourceTrajectoryStepInfo: { cascadeId, stepIndex: 4, trajectoryId },
                stepGenerationVersion: 1,
                viewableAt: generateNanoTimestamp()
            },
            plannerResponse: {
                messageId: `bot-${crypto.randomUUID()}`,
                modifiedResponse: qa.answer,
                response: qa.answer,
                stopReason: 'STOP_REASON_STOP_PATTERN',
                thinking: '**Processing Request**\n\nAnalyzing the user\'s question and formulating a response.\n\n',
                thinkingDuration: generateDuration(0.5, 1.5),
                thinkingSignature: crypto.randomBytes(512).toString('base64')
            },
            status: 'CORTEX_STEP_STATUS_DONE',
            type: 'CORTEX_STEP_TYPE_PLANNER_RESPONSE'
        },
        // Step 5: checkpoint
        {
            checkpoint: { intentOnly: true },
            metadata: {
                createdAt: generateNanoTimestamp(),
                executionId,
                internalMetadata: {
                    statusTransitions: [
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_PENDING' },
                        { timestamp: generateNanoTimestamp(), updatedStatus: 'CORTEX_STEP_STATUS_RUNNING' }
                    ]
                },
                source: 'CORTEX_STEP_SOURCE_SYSTEM',
                sourceTrajectoryStepInfo: { cascadeId, metadataIndex: 1, stepIndex: 5, trajectoryId }
            },
            status: 'CORTEX_STEP_STATUS_RUNNING',
            type: 'CORTEX_STEP_TYPE_CHECKPOINT'
        }
    ];
}

// ==================== Payload ====================

function buildTrajectoryPayload(account, model, requestId) {
    const qa = randomQAPair();
    const cascadeId = crypto.randomUUID();
    const executionId = crypto.randomUUID();
    // 从 requestId 派生 trajectoryId（与 antigravity2api 一致）
    const trajectoryId = requestId?.split('/')[2] || crypto.randomUUID();
    const modelPlaceholder = getModelPlaceholder(model);

    return {
        trajectory: {
            cascadeId,
            executorMetadatas: [{
                executionId,
                lastStepIdx: 5,
                numGeneratorInvocations: 1,
                terminationReason: 'EXECUTOR_TERMINATION_REASON_NO_TOOL_CALL'
            }],
            generatorMetadata: buildGeneratorMetadata(qa, executionId, model),
            metadata: {
                createdAt: generateNanoTimestamp(),
                initializationStateId: crypto.randomUUID(),
                workspaces: [{
                    branchName: 'main',
                    gitRootAbsoluteUri: 'file:///d:/projects/myapp',
                    repository: { computedName: 'user/myapp', gitOriginUrl: 'git@github.com:user/myapp.git' },
                    workspaceFolderAbsoluteUri: 'file:///d:/projects/myapp'
                }]
            },
            source: 'CORTEX_TRAJECTORY_SOURCE_CASCADE_CLIENT',
            steps: buildSteps(executionId, trajectoryId, cascadeId, qa, modelPlaceholder),
            trajectoryId,
            trajectoryType: 'CORTEX_TRAJECTORY_TYPE_CASCADE'
        },
        metadata: generateMetadata(account)
    };
}

// ==================== Export ====================

/**
 * 向上游发送 Trajectory Analytics 数据（fire-and-forget）
 * @param {Object} account - 包含 access_token, device_fingerprint, tier 等的账号对象
 * @param {string} model - 使用的模型名称，映射到对应的 MODEL_PLACEHOLDER
 * @param {string} requestId - 真实请求的 requestId，用于派生 trajectoryId
 */
export async function sendTrajectoryAnalytics(account, model, requestId) {
    if (!account?.access_token) return;

    try {
        await fingerprintFetch(`${BASE_URL}/v1internal:recordTrajectoryAnalytics`, {
            method: 'POST',
            headers: {
                'Host': API_HOST,
                'User-Agent': ANTIGRAVITY_CONFIG.user_agent,
                'Authorization': `Bearer ${account.access_token}`,
                'Content-Type': 'application/json',
                'Accept-Encoding': 'gzip'
            },
            body: JSON.stringify(buildTrajectoryPayload(account, model, requestId))
        });
    } catch { /* fire-and-forget，静默失败 */ }
}
