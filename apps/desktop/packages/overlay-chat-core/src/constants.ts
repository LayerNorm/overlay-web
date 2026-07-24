import type { VideoSubMode } from './types'

export const TOOL_UI_DONE_STATES = new Set(['output-available', 'output-error', 'output-denied'])

export const OVERLAY_LOGO_SRC = '/assets/overlay-logo.png'

export const INTEGRATION_SERVICE_NAMES: Record<string, string> = {
  GMAIL: 'Gmail',
  GOOGLE_CALENDAR: 'Google Calendar',
  GOOGLE_DRIVE: 'Google Drive',
  GOOGLE_SHEETS: 'Google Sheets',
  GOOGLE_DOCS: 'Google Docs',
  SLACK: 'Slack',
  NOTION: 'Notion',
  GITHUB: 'GitHub',
  LINEAR: 'Linear',
  DISCORD: 'Discord',
  OUTLOOK: 'Outlook',
  CAL_COM: 'Cal.com',
  TWITTER: 'Twitter',
  HUBSPOT: 'HubSpot',
  SALESFORCE: 'Salesforce',
  AIRTABLE: 'Airtable',
  ZOOM: 'Zoom',
  TRELLO: 'Trello',
  JIRA: 'Jira',
  DROPBOX: 'Dropbox',
}

export const DEFAULT_CHAT_TITLE = 'New Chat'
export const DEFAULT_CHAT_MODEL_ID = 'claude-sonnet-4-6'
export const IMAGE_MODEL_SELECTION_MODE_KEY = 'overlay_image_model_selection_mode'
export const VIDEO_MODEL_SELECTION_MODE_KEY = 'overlay_video_model_selection_mode'
export const SELECTED_IMAGE_MODELS_KEY = 'overlay_selected_image_models'
export const SELECTED_VIDEO_MODELS_KEY = 'overlay_selected_video_models'
export const CHAT_GEN_MODE_KEY = 'overlay_chat_generation_mode'
export const VIDEO_SUB_MODE_KEY = 'overlay_video_sub_mode'

export const VIDEO_SUB_MODES: { value: VideoSubMode; label: string }[] = [
  { value: 'text-to-video', label: 'Text to Video' },
  { value: 'image-to-video', label: 'Image to Video' },
  { value: 'reference-to-video', label: 'Reference to Video' },
  { value: 'motion-control', label: 'Motion Control' },
  { value: 'video-editing', label: 'Video Editing' },
]

export const VIDEO_SUB_MODE_LABELS = Object.fromEntries(
  VIDEO_SUB_MODES.map(({ value, label }) => [value, label]),
) as Record<VideoSubMode, string>

export const SUPPORTED_INPUT_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

export const ASSISTANT_COLLAPSIBLE_BODY_CLASS =
  'max-h-[min(42vh,300px)] overflow-y-auto overflow-x-hidden overscroll-contain'
