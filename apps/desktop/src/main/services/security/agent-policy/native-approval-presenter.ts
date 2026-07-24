import { BrowserWindow, dialog, type MessageBoxOptions } from 'electron'
import { windowManager } from '../../window-manager'
import type { ApprovalPresenter, ApprovalResponse } from './approval-coordinator'

const MAX_NATIVE_APPROVAL_DISPLAY_CHARS = 16_000

export class NativeAgentApprovalPresenter implements ApprovalPresenter {
  async present(request, decision): Promise<ApprovalResponse> {
    if (decision.outcome !== 'require_approval') return 'deny'
    const exactAction = JSON.stringify(request.display, null, 2)
    if (exactAction.length > MAX_NATIVE_APPROVAL_DISPLAY_CHARS) {
      return 'deny'
    }
    const canGrantTask =
      decision.approval === 'task_grant' && Boolean(decision.registration.capability)
    const buttons = canGrantTask
      ? ['Deny', 'Allow once', 'Allow for this task']
      : ['Deny', 'Allow once']
    const options: MessageBoxOptions = {
      type: 'warning',
      title: 'Approve agent action',
      message: `${decision.registration.name} requests permission`,
      detail: [
        `Security class: ${decision.registration.securityClass}`,
        `Execution target: ${decision.registration.executionTarget}`,
        `Data egress: ${decision.registration.dataEgress}`,
        '',
        'Exact canonical action:',
        exactAction
      ].join('\n'),
      buttons,
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }
    const parent = BrowserWindow.getFocusedWindow() ?? windowManager.findWindowByType('main')
    const result = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options)
    if (result.response === 1) return 'allow_once'
    if (canGrantTask && result.response === 2) return 'allow_task'
    return 'deny'
  }
}

export const nativeAgentApprovalPresenter = new NativeAgentApprovalPresenter()
