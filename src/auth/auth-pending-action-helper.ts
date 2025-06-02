import { customError } from '../utils/logger';

const PENDING_ACTION_TYPE_KEY = 'checkra_auth_pending_action_type';
const PENDING_ACTION_DATA_KEY = 'checkra_auth_pending_action_data';

export interface PendingAction {
  actionType: string | null;
  actionData: any | null;
}

export class AuthPendingActionHelper {
  constructor() {}

  public setPendingAction(actionType: string, actionData?: any): void {
    try {
      localStorage.setItem(PENDING_ACTION_TYPE_KEY, actionType);
      if (actionData !== undefined) {
        localStorage.setItem(PENDING_ACTION_DATA_KEY, JSON.stringify(actionData));
      } else {
        // Ensure data key is removed if actionData is undefined
        localStorage.removeItem(PENDING_ACTION_DATA_KEY);
      }
    } catch (e) {
      customError('[AuthPendingActionHelper] Failed to set pending action:', e);
      // Depending on requirements, this could throw or fail silently.
      // For now, it logs and continues.
    }
  }

  public getPendingAction(): PendingAction {
    try {
      const actionType = localStorage.getItem(PENDING_ACTION_TYPE_KEY);
      const rawActionData = localStorage.getItem(PENDING_ACTION_DATA_KEY);

      if (!actionType) {
        return { actionType: null, actionData: null };
      }

      let actionData: any = null;
      if (rawActionData) {
        try {
          actionData = JSON.parse(rawActionData);
        } catch (e) {
          customError('[AuthPendingActionHelper] Failed to parse pending action data:', e);
          // If data is corrupted, treat it as if no data was present for this action type.
          // The actionType itself might still be valid for actions that don't require data.
        }
      }
      return { actionType, actionData };
    } catch (e) {
      customError('[AuthPendingActionHelper] Failed to get pending action:', e);
      return { actionType: null, actionData: null };
    }
  }

  public clearPendingAction(): void {
    try {
      localStorage.removeItem(PENDING_ACTION_TYPE_KEY);
      localStorage.removeItem(PENDING_ACTION_DATA_KEY);
    } catch (e) {
      customError('[AuthPendingActionHelper] Failed to clear pending action:', e);
    }
  }
} 