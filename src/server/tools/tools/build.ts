import 'server-only'

import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { generatedUiDraftContainsCode } from '@overlay/chat-core/generated-ui'
import { IMAGE_MODELS, getVideoModelsBySubMode } from '@/shared/ai/gateway/model-data'
import {
  executeCreateNote,
  executeDeleteNote,
  executeGetNote,
  executeListNotes,
  executeUpdateNote,
} from './notes-executes'
import { executeBrowserRunTask } from './browser-executes'
import {
  executeCreateAutomation,
  executeDeleteAutomation,
  executeDraftAutomationFromChat,
  executeDraftSkillFromChat,
  executeDeleteMemory,
  executeGenerateImage,
  executeGenerateVideo,
  executePresentGeneratedUi,
  executeListAutomations,
  executeListSkills,
  executePauseAutomation,
  executeRunDaytonaSandbox,
  executeSaveMemory,
  executeSaveMemoryBatch,
  executeSearchInFiles,
  executeSearchKnowledge,
  executeUpdateAutomation,
  executeUpdateMemory,
} from './overlay-executes'
import { assertOverlayToolAllowed } from './policy'
import type { OverlayToolsOptions } from './types'

/**
 * Overlay-defined tools only (no Composio, no Gateway perplexity). Act agent: full tool surface.
 */
export function buildOverlayToolSet(options: OverlayToolsOptions): ToolSet {
  const tools: ToolSet = {}
  const allowedToolIds = options.allowedToolIds ? new Set(options.allowedToolIds) : null
  const memoryEnabled = options.memoryEnabled !== false
  const memoryMutationToolIds = new Set(['save_memory', 'save_memory_batch', 'update_memory', 'delete_memory'])
  const shouldExposeTool = (toolId: string): boolean => {
    if (!memoryEnabled && memoryMutationToolIds.has(toolId)) return false
    return !allowedToolIds || allowedToolIds.has(toolId)
  }
  const assertToolAllowed = (toolId: string): void => assertOverlayToolAllowed(toolId, allowedToolIds)
  const includePaidOnlyOverlay = options.includePaidOnlyOverlayTools !== false
  const generatedUiVariantSchema = z.object({
    id: z.string().min(1).optional(),
    label: z.string().min(1),
    subject: z.string().min(1).optional(),
    body: z.string().min(1),
  }).strict()
  const presentGeneratedUiVariantSchema = z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('draft.text'),
      id: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      body: z.string().min(1).describe('The complete draft text to render in the editable card.'),
      format: z.enum(['plain', 'markdown']).optional(),
    }).strict(),
    z.object({
      kind: z.literal('draft.email'),
      id: z.string().min(1).optional(),
      subject: z.string().min(1),
      body: z.string().min(1).describe('The complete email body to render in the editable card.'),
      to: z.array(z.string().min(1)).max(20).optional(),
      cc: z.array(z.string().min(1)).max(20).optional(),
      bcc: z.array(z.string().min(1)).max(20).optional(),
      provider: z.literal('gmail').optional(),
      variants: z.array(generatedUiVariantSchema).max(6).optional(),
    }).strict(),
    z.object({
      kind: z.literal('connector.connect'),
      id: z.string().min(1).optional(),
      serviceName: z.string().min(1),
      slug: z.string().min(1).optional(),
      description: z.string().min(1).optional(),
      connectUrl: z.string().url().optional(),
      connected: z.boolean().optional(),
    }).strict(),
  ])
  const presentGeneratedUiSchema = z.object({
    kind: z.enum(['draft.text', 'draft.email', 'connector.connect']),
    id: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    body: z.string().min(1).optional(),
    format: z.enum(['plain', 'markdown']).optional(),
    subject: z.string().min(1).optional(),
    to: z.array(z.string().min(1)).max(20).optional(),
    cc: z.array(z.string().min(1)).max(20).optional(),
    bcc: z.array(z.string().min(1)).max(20).optional(),
    provider: z.literal('gmail').optional(),
    variants: z.array(generatedUiVariantSchema).max(6).optional(),
    serviceName: z.string().min(1).optional(),
    slug: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    connectUrl: z.string().url().optional(),
    connected: z.boolean().optional(),
  }).strict().superRefine((input, ctx) => {
    const parsed = presentGeneratedUiVariantSchema.safeParse(input)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue(issue)
      }
      return
    }
    if (generatedUiDraftContainsCode(parsed.data)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['body'],
        message: 'Code must be returned in a fenced Markdown code block, not a generated UI draft.',
      })
    }
  })
  const automationScheduleSchema = z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('interval'),
      intervalMinutes: z.number().int().min(1).max(60 * 24 * 365),
    }),
    z.object({
      kind: z.literal('daily'),
      hourUTC: z.number().int().min(0).max(23),
      minuteUTC: z.number().int().min(0).max(59),
    }),
    z.object({
      kind: z.literal('weekly'),
      dayOfWeekUTC: z.number().int().min(0).max(6),
      hourUTC: z.number().int().min(0).max(23),
      minuteUTC: z.number().int().min(0).max(59),
    }),
    z.object({
      kind: z.literal('monthly'),
      dayOfMonthUTC: z.number().int().min(1).max(31),
      hourUTC: z.number().int().min(0).max(23),
      minuteUTC: z.number().int().min(0).max(59),
    }),
  ])

  tools.present_generated_ui = tool({
    description:
      'Render a polished Overlay UI card in the chat for generated drafts and connector connection prompts. ' +
      'Use this when the user asks you to write an essay, memo, reusable text draft, or email, or when you need to show a connector connection card. ' +
      'This tool is prose-only. Never put source code, HTML, CSS, JavaScript, JSON, SQL, shell commands, configuration, or other machine-readable code in a draft card; return all code in fenced Markdown code blocks instead. ' +
      'After calling this tool, do not duplicate the full draft in normal prose; write only a short lead-in if useful. ' +
      'Never use emojis, pointing-hand callouts, raw JSON, or markdown tables to imitate these cards.',
    inputSchema: presentGeneratedUiSchema,
    execute: async (input) => {
      const parsed = presentGeneratedUiVariantSchema.safeParse(input)
      if (!parsed.success) {
        return { success: false, error: 'Invalid generated UI payload.' }
      }
      return executePresentGeneratedUi(options, parsed.data as Record<string, unknown>)
    },
  })

  if (shouldExposeTool('list_skills')) {
    tools.list_skills = tool({
    description:
      'List all active skills configured by the user. Skills are custom instructions the user has set up for specific task types. ' +
      'IMPORTANT: Call this before taking action on any task to discover whether a relevant skill applies — especially when the request touches a domain the user may have customized (writing style, workflows, personas, integrations, etc.). ' +
      'Use the optional query parameter to filter skills by keyword.',
    inputSchema: z.object({
      query: z.string().optional().describe('Optional keyword to filter skills by name, description, or instructions'),
    }),
    execute: async (input) => {
      assertToolAllowed('list_skills')
      return executeListSkills(options, input)
    },
  })
  }

  if (shouldExposeTool('list_automations')) {
    tools.list_automations = tool({
      description:
        'List the user\'s saved automations, including enabled state, schedule metadata, next run, last run, and last error. Use this in Automate mode or when the user asks about automations.',
      inputSchema: z.object({
        query: z.string().optional().describe('Optional keyword to filter automations by name, description, or instructions'),
      }),
      execute: async (input) => {
        assertToolAllowed('list_automations')
        return executeListAutomations(options, input)
      },
    })
  }

  if (shouldExposeTool('draft_automation_from_chat')) {
    tools.draft_automation_from_chat = tool({
      description:
        'Create an automation draft from the current chat turn. Use this when the user describes a recurring, scheduled, or background workflow. ' +
        'The draft instructions must be a detailed numbered pointer list with concrete tool calls, queries, parallelization notes, formatting instructions, and final delivery steps. ' +
        'After drafting, show the numbered instructions to the user in a fenced code block so they can copy them. This only drafts the automation and never saves or enables it.',
      inputSchema: z.object({
        userText: z.string().describe('The user request to turn into an automation draft'),
        assistantText: z.string().optional().describe('Optional assistant summary of the workflow'),
        reason: z.string().optional().describe('Why this should become a scheduled automation'),
        timezone: z.string().optional().describe('The user timezone if known; default UTC'),
      }),
      execute: async (input) => {
        assertToolAllowed('draft_automation_from_chat')
        return executeDraftAutomationFromChat(options, input)
      },
    })
  }

  if (shouldExposeTool('create_automation')) {
    tools.create_automation = tool({
      description:
        'Create and enable a scheduled automation after the user explicitly confirms the draft. Do not call this for vague ideas; collect name, description, instructions, and schedule first.',
      inputSchema: z.object({
        name: z.string().min(1),
        description: z.string().min(1),
        instructions: z.string().min(1),
        schedule: automationScheduleSchema,
        timezone: z.string().optional(),
        enabled: z.boolean().optional(),
        projectId: z.string().optional(),
        modelId: z.string().optional(),
        graphSource: z.string().optional(),
        sourceConversationId: z.string().optional(),
      }),
      execute: async (input) => {
        assertToolAllowed('create_automation')
        return executeCreateAutomation(options, input)
      },
    })
  }

  if (shouldExposeTool('update_automation')) {
    tools.update_automation = tool({
      description:
        'Update an existing automation. Use for changes to name, description, instructions, schedule, enabled state, timezone, or model.',
      inputSchema: z.object({
        automationId: z.string().min(1),
        name: z.string().optional(),
        description: z.string().optional(),
        instructions: z.string().optional(),
        schedule: automationScheduleSchema.optional(),
        timezone: z.string().optional(),
        enabled: z.boolean().optional(),
        modelId: z.string().optional(),
      }),
      execute: async (input) => {
        assertToolAllowed('update_automation')
        return executeUpdateAutomation(options, input)
      },
    })
  }

  if (shouldExposeTool('pause_automation')) {
    tools.pause_automation = tool({
      description: 'Pause an existing automation so it no longer schedules future runs.',
      inputSchema: z.object({
        automationId: z.string().min(1),
      }),
      execute: async (input) => {
        assertToolAllowed('pause_automation')
        return executePauseAutomation(options, input)
      },
    })
  }

  if (shouldExposeTool('delete_automation')) {
    tools.delete_automation = tool({
      description: 'Delete an existing automation after the user explicitly asks to remove it.',
      inputSchema: z.object({
        automationId: z.string().min(1),
      }),
      execute: async (input) => {
        assertToolAllowed('delete_automation')
        return executeDeleteAutomation(options, input)
      },
    })
  }

  if (shouldExposeTool('search_knowledge')) {
    tools.search_knowledge = tool({
    description:
      memoryEnabled
        ? 'Search the user\'s saved knowledge: indexed files and memories. Uses hybrid semantic + keyword retrieval. Call this when you need facts from their knowledge base, prior notes, or stored context that is not in the chat transcript.'
        : 'Search the user\'s indexed files. Memory is off for this turn, so this tool is restricted to file results.',
    inputSchema: z.object({
      query: z.string().describe('Search query: keywords or a short natural-language question'),
      sourceKind: z
        .enum(['file', 'memory'])
        .optional()
        .describe('Limit to files only or memories only (omit to search both)'),
    }),
    execute: async (input) => {
      assertToolAllowed('search_knowledge')
      return executeSearchKnowledge(options, memoryEnabled ? input : { ...input, sourceKind: 'file' as const })
    },
  })
  }

  if (shouldExposeTool('search_in_files')) {
    tools.search_in_files = tool({
      description:
        'Lexical (substring) search over the user\'s own file rows by Convex file id. Case-insensitive phrase matching with context snippets — works immediately even while vector embeddings are still building. ' +
        'For a document split into multiple parts, pass every part id in order (see system hint for this turn). ' +
        'Use this for exact phrases, names, and codes; use search_knowledge for broader semantic retrieval across indexed files.',
      inputSchema: z.object({
        fileIds: z
          .array(z.string())
          .min(1)
          .describe('Ordered Convex file ids to search (include all part ids for a split upload).'),
        query: z
          .string()
          .min(1)
          .describe('Phrase or keywords to find (case-insensitive substring; not regex).'),
      }),
      execute: async (input) => {
        assertToolAllowed('search_in_files')
        return executeSearchInFiles(options, input)
      },
    })
  }

  if (shouldExposeTool('list_notes')) {
    tools.list_notes = tool({
    description:
      'List the user\'s notes in Overlay. When the chat is tied to a project, pass projectId from context to scope results.',
    inputSchema: z.object({
      projectId: z.string().optional().describe('Only notes in this project (omit for general notes tab)'),
    }),
    execute: async (input) => {
      assertToolAllowed('list_notes')
      return executeListNotes(options, input)
    },
  })
  }

  if (shouldExposeTool('get_note')) {
    tools.get_note = tool({
    description: 'Load a single note by id (full title, body, tags).',
    inputSchema: z.object({
      noteId: z.string().describe('Convex notes document id'),
    }),
    execute: async (input) => {
      assertToolAllowed('get_note')
      return executeGetNote(options, input)
    },
  })
  }

  if (shouldExposeTool('save_memory')) {
    tools.save_memory = tool({
    description:
      'Save a durable memory about the user. ' +
      'DEFAULT: save ANY personal detail, preference, identity, goal, constraint, habit, or standing instruction the user reveals. ' +
      'The only reasons to skip are: (1) the message is pure small talk with zero personal content, (2) it is a one-off task request with no personal detail, or (3) it is only code/data snippets. ' +
      'Always err on the side of saving — the system deduplicates exact duplicates automatically. ' +
      'Use one short factual sentence per call.',
    inputSchema: z.object({
      content: z.string().describe('The memory text to store — one concise factual sentence about the user.'),
      source: z
        .enum(['chat', 'note', 'manual'])
        .optional()
        .describe('How the memory was captured (default: chat when learning from conversation)'),
      type: z
        .enum(['preference', 'fact', 'project', 'decision', 'agent'])
        .optional()
        .describe('Classify the memory: preference = taste/choice; fact = identity/demographic; project = work context; decision = explicit choice; agent = how you should behave toward them.'),
      importance: z
        .number().min(1).max(5).optional()
        .describe('1 = nice-to-know, 3 = useful context, 5 = critical to every future answer (e.g. "always do X").'),
      tags: z
        .array(z.string())
        .optional()
        .describe('1-3 lowercase keyword tags with no spaces, e.g. ["coding","style"].'),
    }),
    execute: async (input) => {
      assertToolAllowed('save_memory')
      return executeSaveMemory(options, input)
    },
  })
  }

  if (shouldExposeTool('save_memory_batch')) {
    tools.save_memory_batch = tool({
    description:
      'Save multiple durable memories about the user in ONE call. REQUIRED when the user shares 2+ personal facts, preferences, identity details, goals, or standing instructions in a single message. ' +
      'Same save rules as save_memory: default to saving everything personal; skip only pure small talk, one-off tasks with no personal detail, or code/data only. ' +
      'Each memory must be one short factual sentence. Up to 10 per call.',
    inputSchema: z.object({
      memories: z.array(
        z.object({
          content: z.string().describe('One short factual sentence about the user.'),
          type: z.enum(['preference', 'fact', 'project', 'decision', 'agent']).optional().describe('Classify the memory type.'),
          importance: z.number().min(1).max(5).optional().describe('1-5 memory importance.'),
          tags: z.array(z.string()).optional().describe('Keyword tags.'),
        })
      ).min(1).max(10).describe('Array of memory objects to save'),
      source: z
        .enum(['chat', 'note', 'manual'])
        .optional()
        .describe('How the memories were captured (default: chat)'),
    }),
    execute: async (input) => {
      assertToolAllowed('save_memory_batch')
      return executeSaveMemoryBatch(options, input)
    },
  })
  }

  if (shouldExposeTool('update_memory')) {
    tools.update_memory = tool({
    description: 'Replace the text (and optionally type/importance/tags) of an existing memory by id. Use after listing or saving a memory.',
    inputSchema: z.object({
      memoryId: z.string().describe('Convex document id of the memory'),
      content: z.string().describe('New full text for the memory'),
      type: z
        .enum(['preference', 'fact', 'project', 'decision', 'agent'])
        .optional()
        .describe('Optionally reclassify the memory type.'),
      importance: z.number().min(1).max(5).optional().describe('Optionally update importance.'),
      tags: z.array(z.string()).optional().describe('Optionally replace tags.'),
    }),
    execute: async (input) => {
      assertToolAllowed('update_memory')
      return executeUpdateMemory(options, input)
    },
  })
  }

  if (shouldExposeTool('delete_memory')) {
    tools.delete_memory = tool({
    description: 'Delete a memory by id.',
    inputSchema: z.object({
      memoryId: z.string().describe('Convex document id of the memory to remove'),
    }),
    execute: async (input) => {
      assertToolAllowed('delete_memory')
      return executeDeleteMemory(options, input)
    },
  })
  }

  if (includePaidOnlyOverlay && shouldExposeTool('interactive_browser_session')) {
    tools.interactive_browser_session = tool({
    description:
      'Remote AI-controlled browser session for INTERACTIVE web tasks only — NOT a search tool. ' +
      'HARD RULE: you are forbidden from calling this tool for any information-gathering, lookup, research, "find sources", "find papers", "find articles", news, reference, citation, or list-building request. Those MUST go through perplexity_search and/or parallel_search (multi-query + domain/recency filters; deep research with long excerpts and includeDomains). ' +
      'Permitted ONLY when ALL of the following are true: (1) the task literally cannot be satisfied by search results + URLs, AND (2) it requires driving a real browser — e.g. logging in with credentials, clicking through a UI flow, submitting a form, scraping a page that actively blocks non-browser clients, operating a JS-heavy SPA, or capturing a screenshot of a specific rendered page. ' +
      'Forbidden examples (use perplexity_search / parallel_search instead): "give me 10 academic sources on X", "find peer-reviewed papers about Y", "cite research on Z", "look up the latest news on …", "find articles about …", "who is …", "what is …", "summarize the state of …". ' +
      'If both web tools ran and returned insufficient or irrelevant results, you may then escalate — but state that in your reasoning. Never call this tool as a first attempt for a research-style question. It is ~10–100× slower and more expensive than web search tools.',
    inputSchema: z.object({
      task: z.string().describe('What to do in the browser — natural language'),
      model: z.enum(['bu-mini', 'bu-max']).optional(),
      sessionId: z.string().optional().describe('Reuse an existing browser session'),
      keepAlive: z.boolean().optional().describe('Keep session alive after task for follow-ups'),
      proxyCountryCode: z.string().optional().describe('2-letter country code for residential proxy'),
    }),
    execute: async (input) => {
      assertToolAllowed('interactive_browser_session')
      return executeBrowserRunTask(options, input)
    },
  })
  }

    if (shouldExposeTool('draft_skill_from_chat')) {
      tools.draft_skill_from_chat = tool({
      description:
        'Create a reusable skill draft from the current chat turn. ' +
        'Use this when the workflow is reusable but not obviously scheduled. ' +
        'This only drafts the skill and never saves it.',
      inputSchema: z.object({
        userText: z.string().describe('The user request to turn into a saved skill draft'),
        assistantText: z.string().optional().describe('Optional assistant summary of the workflow'),
        reason: z.string().optional().describe('Why this should become a saved skill'),
      }),
      execute: async (input) => {
        assertToolAllowed('draft_skill_from_chat')
        return executeDraftSkillFromChat(options, input)
      },
    })
    }

  if (includePaidOnlyOverlay && shouldExposeTool('run_daytona_sandbox')) {
      tools.run_daytona_sandbox = tool({
      description:
        'Run a CLI or script task inside the user’s persistent paid Daytona workspace. ' +
        'Use this for programmatic workflows like app building, code generation, file transforms, slideshow generation, or media pipelines that should run through command-line tooling rather than browser automation. ' +
        'Selected Overlay files are uploaded into the workspace, declared output files are imported back into the Outputs tab, and the workspace persists across runs.',
      inputSchema: z.object({
        task: z.string().describe('Short summary of what the sandbox should do'),
        runtime: z.enum(['node', 'python']).describe('Sandbox runtime: node for JavaScript tooling, python for Python tooling'),
        command: z.string().describe('Shell command to execute inside the sandbox workspace'),
        code: z.string().optional().describe('Optional inline source code to write into the sandbox before execution'),
        inputFileIds: z
          .array(z.string())
          .optional()
          .describe('Optional existing Overlay file ids to upload into the sandbox input directory'),
        expectedOutputs: z
          .array(z.string())
          .min(1)
          .describe('File paths relative to the sandbox workspace that should be imported back into Outputs after execution'),
      }),
      execute: async (input) => {
        assertToolAllowed('run_daytona_sandbox')
        return executeRunDaytonaSandbox(options, input)
      },
    })
    }

    if (shouldExposeTool('create_note')) {
      tools.create_note = tool({
      description: 'Create a new note (title, markdown/plain content, optional tags and project).',
      inputSchema: z.object({
        title: z.string().optional(),
        content: z.string(),
        tags: z.array(z.string()).optional(),
        projectId: z.string().optional(),
      }),
      execute: async (input) => {
        assertToolAllowed('create_note')
        return executeCreateNote(options, input)
      },
    })
    }

    if (shouldExposeTool('update_note')) {
      tools.update_note = tool({
      description: 'Update an existing note by id (any subset of title, content, tags).',
      inputSchema: z.object({
        noteId: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        tags: z.array(z.string()).optional(),
      }),
      execute: async (input) => {
        assertToolAllowed('update_note')
        return executeUpdateNote(options, input)
      },
    })
    }

    if (shouldExposeTool('delete_note')) {
      tools.delete_note = tool({
      description: 'Delete a note by id.',
      inputSchema: z.object({
        noteId: z.string(),
      }),
      execute: async (input) => {
        assertToolAllowed('delete_note')
        return executeDeleteNote(options, input)
      },
    })
    }

  // ── Image & Video generation tools ─────────────────────────────────────────

  if (shouldExposeTool('generate_image')) {
    tools.generate_image = tool({
      description:
        'Generate an image from a text prompt using AI image generation models. ' +
        'Optionally accepts a reference image URL for editing or style transfer. ' +
        'Saves the result to Outputs. ' +
        'Use this whenever the user asks to create, draw, generate, or edit an image or picture.',
      inputSchema: z.object({
        prompt: z.string().describe('Detailed description of the image to generate or edit'),
        modelId: z
          .enum(IMAGE_MODELS.map((m) => m.id) as [string, ...string[]])
          .optional()
          .describe('Specific image model to use (optional — uses priority fallback by default)'),
        aspectRatio: z
          .enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'])
          .optional()
          .describe('Aspect ratio of the generated image (default: 1:1)'),
        referenceImageUrl: z
          .string()
          .optional()
          .describe('URL or data URL of a reference image to edit or use as style source'),
      }),
      execute: async (input) => {
        assertToolAllowed('generate_image')
        return executeGenerateImage(options, input)
      },
    })
  }

  if (shouldExposeTool('generate_video')) {
    const t2vModelIds = getVideoModelsBySubMode('text-to-video').map((m) => m.id) as [string, ...string[]]
    tools.generate_video = tool({
      description:
        'Generate a video from a text prompt (text-to-video). ' +
        'Video generation takes 1–5 minutes; saves the result to Outputs. ' +
        'Supported models: Veo 3.1, Veo 3.1 Fast, Seedance v1.5 Pro, Grok Video, Wan v2.6, Kling v2.6. ' +
        'Use this when the user asks to create or generate a video clip from a description.',
      inputSchema: z.object({
        prompt: z.string().describe('Detailed description of the video to generate'),
        modelId: z.enum(t2vModelIds).optional().describe('Specific model to use (optional)'),
        aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3']).optional().describe('Aspect ratio (default: 16:9)'),
        duration: z.number().min(3).max(12).optional().describe('Duration in seconds (default: 8, max 12)'),
      }),
      execute: async (input) => {
        assertToolAllowed('generate_video')
        return executeGenerateVideo(options, { ...input, videoSubMode: 'text-to-video' })
      },
    })
  }

  if (shouldExposeTool('animate_image')) {
    const i2vModelIds = getVideoModelsBySubMode('image-to-video').map((m) => m.id) as [string, ...string[]]
    tools.animate_image = tool({
      description:
        'Animate a static image into a video (image-to-video). ' +
        'The source image becomes the video — you are adding motion to that exact scene. ' +
        'Supported models: Veo 3.1, Grok Video, Seedance v1.5 Pro, Kling v2.6 I2V, Wan v2.6 I2V. ' +
        'Use this when the user wants to animate, bring to life, or add motion to an existing image.',
      inputSchema: z.object({
        prompt: z.string().describe('Description of the motion or animation to apply'),
        imageUrl: z.string().describe('URL or data URL of the source image to animate'),
        modelId: z.enum(i2vModelIds).optional().describe('Specific model to use (optional)'),
        aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3']).optional().describe('Aspect ratio (default: matches input image)'),
        duration: z.number().min(3).max(15).optional().describe('Duration in seconds (default: 5)'),
      }),
      execute: async (input) => {
        assertToolAllowed('animate_image')
        return executeGenerateVideo(options, { ...input, videoSubMode: 'image-to-video' })
      },
    })
  }

  if (shouldExposeTool('generate_video_with_reference')) {
    const r2vModelIds = getVideoModelsBySubMode('reference-to-video').map((m) => m.id) as [string, ...string[]]
    tools.generate_video_with_reference = tool({
      description:
        'Generate a new video scene featuring characters from reference images (reference-to-video). ' +
        'The reference images show what characters look like; your prompt describes a completely new scene. ' +
        'Use character1, character2, etc. in the prompt to refer to each reference. ' +
        'Supported model: Wan v2.6 R2V. ' +
        'Use this when the user wants to place characters from photos into a new video scene.',
      inputSchema: z.object({
        prompt: z.string().describe('Scene description using character1, character2, etc. to reference each character'),
        referenceUrl: z.string().describe('URL of a reference image or video showing the character'),
        modelId: z.enum(r2vModelIds).optional().describe('Specific model to use (optional)'),
        duration: z.number().min(2).max(10).optional().describe('Duration in seconds (default: 5)'),
      }),
      execute: async (input) => {
        assertToolAllowed('generate_video_with_reference')
        return executeGenerateVideo(options, { prompt: input.prompt, modelId: input.modelId, duration: input.duration, videoSubMode: 'reference-to-video', imageUrl: input.referenceUrl })
      },
    })
  }

  if (shouldExposeTool('apply_motion_control')) {
    const motionModelIds = getVideoModelsBySubMode('motion-control').map((m) => m.id) as [string, ...string[]]
    tools.apply_motion_control = tool({
      description:
        'Transfer motion from a reference video onto a character image (motion control). ' +
        'The model analyzes movements in the reference video and applies them to the character. ' +
        'Supported model: Kling v2.6 Motion Control. ' +
        'Use this when the user wants to make a character perform the same actions as someone in a video.',
      inputSchema: z.object({
        prompt: z.string().describe('Optional description of scene elements or camera movement'),
        characterImageUrl: z.string().describe('URL of the character image to apply motion to'),
        referenceVideoUrl: z.string().describe('URL of the reference video whose motion to transfer'),
        modelId: z.enum(motionModelIds).optional().describe('Specific model to use (optional)'),
      }),
      execute: async (input) => {
        assertToolAllowed('apply_motion_control')
        return executeGenerateVideo(options, { prompt: input.prompt, modelId: input.modelId, videoSubMode: 'motion-control', imageUrl: input.characterImageUrl, referenceVideoUrl: input.referenceVideoUrl })
      },
    })
  }

  if (shouldExposeTool('edit_video')) {
    const editVideoModelIds = getVideoModelsBySubMode('video-editing').map((m) => m.id) as [string, ...string[]]
    tools.edit_video = tool({
      description:
        'Edit an existing video using a text prompt (video editing). ' +
        'Describe the changes and the model modifies the video accordingly. ' +
        'Supported model: Grok Video (max 8.7s input, output up to 720p). ' +
        'Use this when the user wants to modify, restyle, or transform an existing video.',
      inputSchema: z.object({
        prompt: z.string().describe('Description of the edits to apply to the video'),
        videoUrl: z.string().describe('URL of the source video to edit'),
        modelId: z.enum(editVideoModelIds).optional().describe('Specific model to use (optional)'),
      }),
      execute: async (input) => {
        assertToolAllowed('edit_video')
        return executeGenerateVideo(options, { prompt: input.prompt, modelId: input.modelId, videoSubMode: 'video-editing', imageUrl: input.videoUrl })
      },
    })
  }

  return tools
}
