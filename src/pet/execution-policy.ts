import type { AppSettings } from '../types';
import { ACTION_PRIORITY } from '../actions/types';

export function permitsExecution(settings: AppSettings | null, priority: number, currentActionId?: string | null) {
  return !!settings?.petVisible
    && (priority !== ACTION_PRIORITY.background
      || (settings.autonomousBehavior && !currentActionId?.startsWith('recovery:')));
}
