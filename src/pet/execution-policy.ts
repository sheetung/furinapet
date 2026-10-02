import type { AppSettings } from '../types';
import { ACTION_PRIORITY } from '../actions/types';

export function permitsExecution(settings: AppSettings | null, priority: number) {
  return !!settings?.petVisible
    && (priority !== ACTION_PRIORITY.background || settings.autonomousBehavior);
}
