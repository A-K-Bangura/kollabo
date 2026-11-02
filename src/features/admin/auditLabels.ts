const ACTION_TEXT: Record<string, string> = {
  'project.rename': 'Renamed the project',
  'project.suspend': 'Suspended the project',
  'project.reactivate': 'Reactivated the project',
  'project.delete': 'Deleted the project',
  'project.restore': 'Restored the project',
  'project.rotate_code': 'Rotated the access code',
  'member.add': 'Added members',
  'member.rename': 'Renamed a member',
  'member.deactivate': 'Removed a member',
  'member.reactivate': 'Brought a member back',
  'task.create': 'Created a task',
  'task.update': 'Edited a task',
  'task.delete': 'Deleted a task',
  'task.progress_override': 'Changed someone’s progress',
  'task.reopen': 'Reopened a task',
  'task.note_edit': 'Edited a progress note',
  'task.note_clear': 'Cleared a progress note',
  'admin.sign_in': 'Signed in',
  'admin.sign_out': 'Signed out',
  'admin.mfa_enrolled': 'Turned on two-factor authentication',
  'admin.password_changed': 'Changed their password',
  'admin.backup_codes_regenerated': 'Regenerated backup codes',
  'admin.create': 'Added an administrator',
  'admin.deactivate': 'Deactivated an administrator',
  'admin.reactivate': 'Reactivated an administrator',
}

export function auditText(action: string): string {
  return ACTION_TEXT[action] ?? action
}
