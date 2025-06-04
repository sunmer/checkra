import { customError, customWarn } from '../utils/logger';
import { startLogin, isLoggedIn, AuthenticationRequiredError } from './auth';
// import type { CheckraImplementation } from '../ui/checkra-impl'; // REMOVED
import type { AppliedFixInfo } from '../ui/applied-fix-store';
import { getFriendlyQueryName } from '../analytics/stats-fetcher';

const PENDING_ACTION_TYPE_KEY = 'checkra_auth_pending_action_type';
const PENDING_ACTION_DATA_KEY = 'checkra_auth_pending_action_data';

export interface PendingAction {
  actionType: string | null;
  actionData: any | null;
}

// Define an interface for the parts of CheckraImplementation needed by the helper
export interface AuthCallbackInterface {
  renderUserMessage(message: string): void;
  showError(error: Error | string): void;
  initiateStatsFetch(queryName: string): Promise<void>;
  handlePublishCommand(): Promise<void>;
  handleSaveDraftCommand(): Promise<void>;
  appliedFixStore: { // Simplified interface for what's needed from AppliedFixStore
    clear(): void;
    add(key: string, value: AppliedFixInfo): void;
    getSize(): number;
  };
  // Add any other methods from CheckraImplementation that might be called by these auth handlers
}

export class AuthPendingActionHelper {
  constructor() {}

  public setPendingAction(actionType: string, data?: any): void {
    try {
      localStorage.setItem(PENDING_ACTION_TYPE_KEY, actionType);
      if (data) {
        localStorage.setItem(PENDING_ACTION_DATA_KEY, JSON.stringify(data));
      }
    } catch (e) {
      customError('[AuthPendingActionHelper] Failed to set pending action:', e);
    }
  }

  public getPendingAction(): PendingAction {
    try {
      const actionType = localStorage.getItem(PENDING_ACTION_TYPE_KEY);
      const actionDataString = localStorage.getItem(PENDING_ACTION_DATA_KEY);
      let actionData = null;
      if (actionDataString) {
        try {
          actionData = JSON.parse(actionDataString);
        } catch (parseError) {
          customError('[AuthPendingActionHelper] Failed to parse pending action data:', parseError);
          this.clearPendingAction(); // Clear corrupted data
          return { actionType: null, actionData: null };
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

  public async handleAuthenticationRequiredAndRedirect(
    actionType: string, 
    actionData: any, 
    authError: AuthenticationRequiredError,
    uiCallbacks: Pick<AuthCallbackInterface, 'showError'> // Only showError is needed here
  ): Promise<void> {
    try {
      this.setPendingAction(actionType, actionData);
      
      const loginUrlFromError = authError?.loginUrl;
      // Assuming Checkra is globally available for REDIRECT_URI or a config is imported
      const redirectUri = (window as any).Checkra?.REDIRECT_URI ?? location.origin + '/auth/callback';
      const encodedRedirect = encodeURIComponent(redirectUri);
      const safeToUseLoginUrl = loginUrlFromError && loginUrlFromError.includes(`redirect_to=${encodedRedirect}`);

      if (safeToUseLoginUrl) {
        window.location.href = loginUrlFromError;
      } else {
        customWarn('[AuthPendingActionHelper] Backend loginUrl missing or has wrong redirect_to. Falling back to startLogin().');
        try {
          await startLogin(); // startLogin should handle its own redirects
        } catch (loginError) {
          customError('[AuthPendingActionHelper] Error calling startLogin():', loginError);
          uiCallbacks.showError('Authentication is required. Auto-redirect to login failed.');
        }
      }
    } catch (e) {
      customError('[AuthPendingActionHelper] Failed to store pending action or initiate login:', e);
      uiCallbacks.showError('Could not prepare for login. Please try again.');
    }
  }

  public async handlePendingActionAfterLogin(uiCallbacks: AuthCallbackInterface): Promise<void> {
    const pendingAction = this.getPendingAction();
    const { actionType, actionData } = pendingAction;

    if (actionType) {
      const loggedIn = await isLoggedIn();
      if (!loggedIn) {
        customWarn('[AuthPendingActionHelper] User not logged in after redirect. Pending action not resumed.');
        this.clearPendingAction(); // Clear if not logged in to avoid loops
        return; 
      }

      this.clearPendingAction();

      switch (actionType) {
        case 'publish':
        case 'saveDraft': 
          if (actionData && Array.isArray(actionData)) {
            try {
              uiCallbacks.appliedFixStore.clear(); 
              const restoredMap = new Map<string, AppliedFixInfo>(actionData as Array<[string, AppliedFixInfo]>);
              restoredMap.forEach((value, key) => uiCallbacks.appliedFixStore.add(key, value));
              
              if (uiCallbacks.appliedFixStore.getSize() === 0 && actionType === 'publish') { 
                  uiCallbacks.renderUserMessage("No changes were pending to publish after login.");
                  return;
              }
              if (uiCallbacks.appliedFixStore.getSize() === 0 && actionType === 'saveDraft') { 
                uiCallbacks.renderUserMessage("No changes were pending to save as draft after login.");
                return;
              }
            } catch (e) {
              customError('[AuthPendingActionHelper] Error restoring appliedFixes from localStorage:', e);
              uiCallbacks.showError(`Failed to restore changes for ${actionType}.`);
              return;
            }
          } else if (uiCallbacks.appliedFixStore.getSize() === 0) { 
            uiCallbacks.renderUserMessage(`No changes were pending to ${actionType} after login.`);
            return;
          }
          
          uiCallbacks.renderUserMessage(`Resuming ${actionType} operation after login...`);
          if (actionType === 'publish') {
            await uiCallbacks.handlePublishCommand();
          } else if (actionType === 'saveDraft') {
            await uiCallbacks.handleSaveDraftCommand();
          }
          break;
        case 'fetchStats':
          if (actionData && typeof actionData.queryName === 'string') {
            uiCallbacks.renderUserMessage(`Resuming stats fetch for ${getFriendlyQueryName(actionData.queryName)} after login...`);
            await uiCallbacks.initiateStatsFetch(actionData.queryName);
          } else {
            customError('[AuthPendingActionHelper] Invalid or missing queryName for pending fetchStats action.');
            uiCallbacks.showError('Could not restore stats fetch: missing query details.');
          }
          break;
        default:
          customWarn(`[AuthPendingActionHelper] Unknown pending action type: ${actionType}`);
      }
    } 
  }

  public handleAuthErrorInUrl(uiCallbacks: Pick<AuthCallbackInterface, 'renderUserMessage'>): void {
    const params = new URLSearchParams(location.search);
    const errorCode = params.get('error');
    const errorDesc = params.get('error_description');
    if (errorCode) {
      customWarn('[AuthPendingActionHelper] Supabase auth error detected in URL:', errorCode, errorDesc);
      uiCallbacks.renderUserMessage(`Login failed: ${errorDesc || errorCode}. Please contact support or retry later.`);
      params.delete('error');
      params.delete('error_code');
      params.delete('error_description');
      const newUrl = `${location.pathname}${params.toString() ? '?' + params.toString() : ''}${location.hash}`;
      history.replaceState(null, '', newUrl);
    }
  }
} 