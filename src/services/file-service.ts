import { ErrorInfo } from '../types'; // Assuming you have this type defined elsewhere
import * as parser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types'; // Import * as t for type checking (e.g., t.isFunctionDeclaration)

/**
 * Service for handling file operations and code fixes using Babel AST manipulation.
 */
export class FileService {
  /**
   * Requests access to a file for modification
   * (Kept the same as the original - no changes needed here)
   */
  public async requestFileAccess(
    fileName: string,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<FileSystemFileHandle | null> {
    try {
      // Check if the File System Access API is available
      if (!('showOpenFilePicker' in window)) {
        statusCallback?.('File System Access API is not supported in this browser.', 'error');
        return null;
      }

      statusCallback?.('Please select the file to modify...', 'info');

      // Request the user to select the file with broader file type acceptance
      const [fileHandle] = await (window as any).showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: 'All Source Code Files',
            accept: {
              'text/javascript': ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
              'text/typescript': ['.ts', '.tsx'],
              'application/json': ['.json'], // Keep JSON simple for now
              'text/html': ['.html'], // HTML/CSS won't use Babel
              'text/css': ['.css'],
            }
          }
        ]
      });

      // Get selected file info
      const file = await fileHandle.getFile();
      const selectedFileName = file.name;

      // Extract just the file name from the full path for informational purposes
      const expectedFileName = fileName.split('/').pop() || fileName;

      if (selectedFileName !== expectedFileName) {
        statusCallback?.(
          `Selected file "${selectedFileName}" will be used instead of "${expectedFileName}".`,
          'info'
        );
      }

      statusCallback?.('File access granted.', 'success');
      return fileHandle;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        statusCallback?.('File selection was cancelled.', 'info');
      } else {
        statusCallback?.(
          `Error accessing file: ${error instanceof Error ? error.message : String(error)}`,
          'error'
        );
      }
      return null;
    }
  }

  /**
   * Applies a code fix to a file using Babel AST manipulation.
   *
   * @param fileHandle File handle to modify
   * @param originalFileContent Original file content as a single string
   * @param originalSourceSnippet Original source snippet (used for identification hint)
   * @param newCodeSnippet New code snippet to replace the original block
   * @param errorInfo Error information including line numbers
   * @param statusCallback Optional callback to report status
   * @returns Boolean indicating success
   */
  public async applyCodeFix(
    fileHandle: FileSystemFileHandle,
    originalFileContent: string,
    originalSourceSnippet: string, // Keep for potential comparison/hinting, but less critical
    newCodeSnippet: string,
    errorInfo: ErrorInfo,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
    const fileName = fileHandle.name;
    const isJsTsFile = /\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(fileName);

    // If not a JS/TS file, fall back to simple replacement or clipboard
    if (!isJsTsFile) {
        statusCallback?.(`File type (${fileName}) not supported by Babel. Attempting direct replacement.`, 'warning');
        return this.applySimpleFix(fileHandle, originalFileContent, originalSourceSnippet, newCodeSnippet, statusCallback);
    }

    const cleanedNewCode = this.cleanCodeExample(newCodeSnippet);
    const lineHint = errorInfo.lineNumber || 1;

    // --- Start of main try block ---
    try {
      statusCallback?.('Parsing file content with Babel...', 'info');

      // --- 1. Parse the original file content ---
      const ast = parser.parse(originalFileContent, {
        sourceType: 'module', // Or 'script' if more appropriate
        plugins: [
          'typescript', // Enable TypeScript syntax
          'jsx',        // Enable JSX syntax
          // Add other plugins if needed (e.g., 'decorators-legacy', 'classProperties')
        ],
        errorRecovery: true, // Try to parse even with minor errors
      });

      // --- 2. Parse the new code snippet ---
      let newAstNodes: t.Statement[] | null = null;
      try {
        // Try parsing as a full program body
        const newAst = parser.parse(cleanedNewCode, {
           sourceType: 'module',
           plugins: ['typescript', 'jsx'],
           allowReturnOutsideFunction: true, // Helps parse snippets
        });
        newAstNodes = newAst.program.body;
        if (newAstNodes.length === 0 && newAst.program.directives.length > 0) {
            // Handle cases like "use strict"; being parsed as a directive
            newAstNodes = newAst.program.directives.map(dir => t.expressionStatement(t.stringLiteral(dir.value.value)));
        }
      } catch (snippetParseError) {
         // If parsing the whole snippet fails, maybe it's just an expression?
         try {
            const expressionNode = parser.parseExpression(cleanedNewCode, {
                 plugins: ['typescript', 'jsx'],
            });
            // Wrap expression in an ExpressionStatement to be insertable as a statement
            newAstNodes = [t.expressionStatement(expressionNode)];
         } catch (expressionParseError) {
             statusCallback?.(`Failed to parse the new code snippet: ${snippetParseError instanceof Error ? snippetParseError.message : String(snippetParseError)}`, 'error');
             await this.copyToClipboard(cleanedNewCode);
             statusCallback?.('New code copied to clipboard due to parsing error.', 'warning');
             return false;
         }
      }

      // It's possible parsing succeeded but resulted in no statements (e.g. comments only)
      if (!newAstNodes) {
        statusCallback?.('New code snippet resulted in invalid AST nodes after parsing.', 'error');
        return false;
      }
       // Note: newAstNodes can be an empty array [] here if the snippet was empty or only comments after cleaning. This is handled later.


      // --- 3. Traverse the AST to find the node to replace ---
      statusCallback?.(`Searching for code block near line ${lineHint}...`, 'info');
      let replacementMade = false;
      // *** Initialize errorNodePath correctly ***
      let errorNodePath: NodePath;
      // Initialize to null and allow null/undefined type (findParent can return null/undefined)
      let functionNodePath: NodePath;
      let minErrorNodeDistance = Infinity;

      // First pass: Find the most specific node containing the error line
      let functionNodes: NodePath[] = [];
      traverse(ast, {
        enter(path) {
          if (!path.node.loc) return;
          const startLine = path.node.loc.start.line;
          const endLine = path.node.loc.end.line;

          // Track all function-like nodes containing the error line for later prioritization
          if (lineHint >= startLine && lineHint <= endLine && (
            path.isFunctionDeclaration() || 
            path.isFunctionExpression() || 
            path.isArrowFunctionExpression() || 
            path.isObjectMethod() || 
            path.isClassMethod() ||
            (path.isVariableDeclaration() && path.node.declarations.some(decl => 
              decl.init && (
                t.isFunctionExpression(decl.init) || 
                t.isArrowFunctionExpression(decl.init)
              )
            )) ||
            (path.isExportNamedDeclaration() && (
              (path.node.declaration && (
                t.isFunctionDeclaration(path.node.declaration) ||
                (t.isVariableDeclaration(path.node.declaration) && 
                 path.node.declaration.declarations.some(decl => 
                   decl.init && (t.isFunctionExpression(decl.init) || t.isArrowFunctionExpression(decl.init))
                 ))
              ))
            )) ||
            path.isExportDefaultDeclaration()
          )) {
            functionNodes.push(path);
          }

          if (lineHint >= startLine && lineHint <= endLine) {
            const distance = Math.abs(startLine - lineHint);
            const lineSpan = endLine - startLine;
            
            let currentBestDistance = Infinity;
            if (errorNodePath?.node?.loc) {
              currentBestDistance = Math.abs(errorNodePath.node.loc.start.line - lineHint);
            }
            
            // Original heuristic: still useful as fallback
            if (lineSpan < minErrorNodeDistance || (lineSpan === minErrorNodeDistance && distance < currentBestDistance)) {
              minErrorNodeDistance = lineSpan;
              errorNodePath = path;
            }
          }
        }
      });

      // Prioritize function nodes if available
      if (functionNodes.length > 0) {
        // Score function nodes by proximity to line hint and node type importance
        const scoredNodes = functionNodes.map(path => {
          let score = 0;
          
          // Prefer nodes closer to the error line
          if (path.node.loc) {
            score -= Math.abs(path.node.loc.start.line - lineHint);
          }
          
          // Boost specific node types
          if (path.isExportNamedDeclaration() || path.isExportDefaultDeclaration()) score += 30;
          else if (path.isFunctionDeclaration()) score += 25;
          else if (path.isVariableDeclaration()) score += 20;
          else if (path.isFunctionExpression() || path.isArrowFunctionExpression()) score += 15;
          else if (path.isObjectMethod() || path.isClassMethod()) score += 10;
          
          return { path, score };
        });
        
        // Sort by score (highest first)
        scoredNodes.sort((a, b) => b.score - a.score);
        
        // Use highest scoring function node if available
        if (scoredNodes.length > 0) {
          statusCallback?.(`Found ${functionNodes.length} function nodes. Using highest scored node type: ${scoredNodes[0].path.node.type}`, 'info');
          errorNodePath = scoredNodes[0].path;
        }
      }

      // --- Guard Clause ---
      // This check now correctly narrows errorNodePath to NodePath for the rest of the function scope
      // @ts-ignore
      if (!errorNodePath) {
        statusCallback?.('Could not find any AST node containing the specified line.', 'warning');
        await this.copyToClipboard(cleanedNewCode);
        statusCallback?.('Code fix copied to clipboard.', 'warning');
        return false;
      }
      // --- End Guard Clause ---

      // Now it's safe to call methods on errorNodePath because the function would have returned if it was null
      // @ts-ignore
      functionNodePath = errorNodePath.findParent(
          (p) => p.isFunctionDeclaration() ||
                 p.isFunctionExpression() ||
                 p.isArrowFunctionExpression() ||
                 p.isObjectMethod() ||
                 p.isClassMethod()
      );

      // If the functionNode is inside a VariableDeclarator (like const fn = () => ...),
      // the actual replaceable unit might be the VariableDeclaration
      let topLevelFunctionPath: NodePath | null = null; // Keep this as NodePath | null

      // This check correctly guards functionNodePath
      if (functionNodePath) {
          // It's safe to call methods on functionNodePath here
          const variableDeclaratorParent = functionNodePath.findParent((p) => p.isVariableDeclarator());
          if (variableDeclaratorParent) {
              const variableDeclarationParent = variableDeclaratorParent.findParent((p) => p.isVariableDeclaration());
              if (variableDeclarationParent) {
                  topLevelFunctionPath = variableDeclarationParent; // Target the whole 'const fn = ...;'
              } else {
                   topLevelFunctionPath = functionNodePath; // Should not happen often, fallback
              }
          } else {
             topLevelFunctionPath = functionNodePath; // Regular function or method
          }
      }


      // --- 4. Perform the replacement ---
      // errorNodePath is guaranteed to be NodePath here
      statusCallback?.(
        `Found error node: ${errorNodePath.node.type} at lines ${errorNodePath.node.loc?.start.line}-${errorNodePath.node.loc?.end.line}.`,
        'info'
      );

      // This check correctly guards topLevelFunctionPath
      if (topLevelFunctionPath) {
           statusCallback?.(
                // It's safe to access topLevelFunctionPath.node here
                `Enclosing function context: ${topLevelFunctionPath.node.type} at lines ${topLevelFunctionPath.node.loc?.start.line}-${topLevelFunctionPath.node.loc?.end.line}.`,
                'info'
           );
      }


      // --- Strategy A: Try Full Function Replacement ---
      if (topLevelFunctionPath && newAstNodes.length === 1) {
        const newNode = newAstNodes[0];
        
        // Enhance node type checking to handle more equivalence cases
        const isNodeCompatible = () => {
          // Direct type match
          if (newNode.type === topLevelFunctionPath.node.type) return true;
          
          // Function declaration can replace variable declaration with function expression and vice versa
          if (t.isFunctionDeclaration(newNode) && 
              (t.isVariableDeclaration(topLevelFunctionPath.node) || t.isExportNamedDeclaration(topLevelFunctionPath.node))) {
            return true;
          }
          
          if (t.isVariableDeclaration(newNode) && 
              (t.isFunctionDeclaration(topLevelFunctionPath.node) || t.isExportNamedDeclaration(topLevelFunctionPath.node))) {
            return true;
          }
          
          // Export named declaration can replace function or variable
          if (t.isExportNamedDeclaration(newNode) && 
              (t.isFunctionDeclaration(topLevelFunctionPath.node) || t.isVariableDeclaration(topLevelFunctionPath.node))) {
            return true;
          }
          
          return false;
        };
        
        // More flexible compatibility checking
        const isCompatibleVarDecl = t.isVariableDeclaration(newNode) && 
          t.isVariableDeclaration(topLevelFunctionPath.node) &&
          newNode.declarations.length > 0 && 
          topLevelFunctionPath.node.declarations.length > 0 &&
          (newNode.declarations[0].init && topLevelFunctionPath.node.declarations[0].init && 
           (t.isFunctionExpression(newNode.declarations[0].init) || t.isArrowFunctionExpression(newNode.declarations[0].init)) &&
           (t.isFunctionExpression(topLevelFunctionPath.node.declarations[0].init) || t.isArrowFunctionExpression(topLevelFunctionPath.node.declarations[0].init))
          );

        const isDirectFunctionMatch = !t.isVariableDeclaration(newNode) &&
          !t.isVariableDeclaration(topLevelFunctionPath.node) &&
          (t.isFunctionDeclaration(newNode) || t.isFunctionExpression(newNode) || t.isArrowFunctionExpression(newNode)) &&
          (t.isFunctionDeclaration(topLevelFunctionPath.node) || t.isFunctionExpression(topLevelFunctionPath.node) || t.isArrowFunctionExpression(topLevelFunctionPath.node));

        const isExportNamedMatch = (t.isExportNamedDeclaration(newNode) || t.isExportDefaultDeclaration(newNode)) &&
          (t.isExportNamedDeclaration(topLevelFunctionPath.node) || t.isExportDefaultDeclaration(topLevelFunctionPath.node) || 
           t.isFunctionDeclaration(topLevelFunctionPath.node) || 
          (t.isVariableDeclaration(topLevelFunctionPath.node) && topLevelFunctionPath.node.declarations.length > 0));

        if (isCompatibleVarDecl || isDirectFunctionMatch || isExportNamedMatch || isNodeCompatible()) {
          statusCallback?.(`Attempting Strategy A: Replacing entire ${topLevelFunctionPath.node.type}...`, 'info');
          try {
            // Prepare the new node based on the target type for better compatibility
            let replacementNode = newNode;
            
            // When replacing export with non-export or vice versa, adapt the node
            if (t.isExportNamedDeclaration(topLevelFunctionPath.node) && !t.isExportNamedDeclaration(newNode)) {
              // Only declarations can be directly exported
              if (t.isFunctionDeclaration(newNode) || 
                  t.isClassDeclaration(newNode) || 
                  t.isVariableDeclaration(newNode) ||
                  t.isTSInterfaceDeclaration(newNode) ||
                  t.isTSTypeAliasDeclaration(newNode)) {
                // This is a valid declaration that can be exported
                replacementNode = t.exportNamedDeclaration(newNode, [], null);
              } else {
                // For non-declaration nodes, we need special handling
                statusCallback?.('Cannot directly export this node type. Keeping original export structure.', 'warning');
                // Try to maintain the original export but replace its inner content
              }
            } else if (!t.isExportNamedDeclaration(topLevelFunctionPath.node) && t.isExportNamedDeclaration(newNode)) {
              // Extract the declaration from export
              replacementNode = newNode.declaration || newNode;
            }
            
            topLevelFunctionPath.replaceWith(replacementNode);
            replacementMade = true;
            statusCallback?.('Strategy A: Full function replacement successful.', 'success');
          } catch (replaceError) {
            statusCallback?.(`Strategy A failed: ${replaceError instanceof Error ? replaceError.message : String(replaceError)}`, 'warning');
            console.error("AST Replacement Error (Strategy A):", replaceError);
          }
        } else {
          // Safe access
          statusCallback?.(`Strategy A skipped: New node type (${newNode.type}) doesn't match function context type (${topLevelFunctionPath.node.type}) or structure.`, 'info');
        }
      } else if (newAstNodes.length > 1 && topLevelFunctionPath) {
        statusCallback?.(`Strategy A skipped: New code has multiple statements, cannot replace single function declaration.`, 'info');
      } else {
        statusCallback?.(`Strategy A skipped: Could not identify suitable enclosing function or new code is not a single node.`, 'info');
      }


      // --- Strategy B: Try Targeted Replacement (if Strategy A failed or wasn't applicable) ---
      // Note: newAstNodes cannot be null here
      if (!replacementMade && newAstNodes.length > 0) {
        statusCallback?.('Attempting Strategy B: Targeted replacement near error line...', 'info');
        let targetPathForB = errorNodePath;

        try {
          // Check for potential duplicates before insertion
          let willCreateDuplicate = false;
          let duplicateNode: NodePath | null = null;
          
          // Only check for duplicates if inserting functions
          if (newAstNodes.some(node => 
            t.isFunctionDeclaration(node) || 
            t.isVariableDeclaration(node) || 
            t.isExportNamedDeclaration(node) ||
            t.isExportDefaultDeclaration(node)
          )) {
            // Extract function names from new nodes
            const newNames: string[] = [];
            newAstNodes.forEach(node => {
              if (t.isFunctionDeclaration(node) && node.id) {
                newNames.push(node.id.name);
              } else if (t.isVariableDeclaration(node) && node.declarations.length > 0 && t.isIdentifier(node.declarations[0].id)) {
                newNames.push(node.declarations[0].id.name);
              } else if (t.isExportNamedDeclaration(node) && node.declaration) {
                if (t.isFunctionDeclaration(node.declaration) && node.declaration.id) {
                  newNames.push(node.declaration.id.name);
                } else if (t.isVariableDeclaration(node.declaration) && 
                          node.declaration.declarations.length > 0 && 
                          t.isIdentifier(node.declaration.declarations[0].id)) {
                  newNames.push(node.declaration.declarations[0].id.name);
                }
              }
            });
            
            // Look for any existing nodes with the same names
            if (newNames.length > 0) {
              traverse(ast, {
                enter(path) {
                  // Skip the current node
                  if (path === targetPathForB || path === errorNodePath) return;
                  
                  let nodeName = '';
                  if (t.isFunctionDeclaration(path.node) && path.node.id) {
                    nodeName = path.node.id.name;
                  } else if (t.isVariableDeclaration(path.node) && 
                            path.node.declarations.length > 0 && 
                            t.isIdentifier(path.node.declarations[0].id)) {
                    nodeName = path.node.declarations[0].id.name;
                  } else if (t.isExportNamedDeclaration(path.node) && path.node.declaration) {
                    if (t.isFunctionDeclaration(path.node.declaration) && path.node.declaration.id) {
                      nodeName = path.node.declaration.id.name;
                    } else if (t.isVariableDeclaration(path.node.declaration) && 
                              path.node.declaration.declarations.length > 0 && 
                              t.isIdentifier(path.node.declaration.declarations[0].id)) {
                      nodeName = path.node.declaration.declarations[0].id.name;
                    }
                  }
                  
                  if (newNames.includes(nodeName)) {
                    willCreateDuplicate = true;
                    duplicateNode = path;
                    path.stop(); // Stop traversal once found
                  }
                }
              });
            }
          }
          
          // If we detected a potential duplicate, try to replace it instead
          if (willCreateDuplicate && duplicateNode) {
            statusCallback?.(`Found existing declaration with same name. Replacing to avoid duplicates.`, 'info');
            
            if (newAstNodes.length === 1) {
              // Cast duplicateNode to NodePath to access replaceWith
              (duplicateNode as NodePath).replaceWith(newAstNodes[0]); 
            } else if ((duplicateNode as NodePath).parentPath?.isBlockStatement() || 
                      (duplicateNode as NodePath).parentPath?.isProgram() ||
                      (duplicateNode as NodePath).inList) {
              (duplicateNode as NodePath).replaceWithMultiple(newAstNodes);
            } else {
              statusCallback?.(`Cannot replace duplicate with multiple nodes in this context.`, 'warning');
              // Continue with normal strategy B, might create duplicate but better than failing
              willCreateDuplicate = false;
            }
            
            if (willCreateDuplicate) {
              replacementMade = true;
              statusCallback?.('Successfully replaced existing declaration to avoid duplicate.', 'success');
            }
          }
          
          // Continue with original Strategy B if no duplicates were handled
          if (!willCreateDuplicate) {
            // Safe access to targetPathForB properties/methods
            const canReplaceWithMultiple = targetPathForB.parentPath?.isBlockStatement() ||
                                          targetPathForB.parentPath?.isProgram() ||
                                          targetPathForB.inList;

            if (newAstNodes.length === 1) {
                // Try replacing the specific error node first
                targetPathForB.replaceWith(newAstNodes[0]);
                replacementMade = true;
            } else if (canReplaceWithMultiple) {
                 // Try replacing the specific error node with multiple nodes
                targetPathForB.replaceWithMultiple(newAstNodes);
                replacementMade = true;
            } else {
                // Cannot replace error node directly with multiple nodes, try parent statement
                statusCallback?.(`Cannot replace ${targetPathForB.node.type} with multiple nodes here. Trying parent statement...`, 'warning');
                if (targetPathForB.parentPath?.isStatement()) {
                    targetPathForB.parentPath.replaceWithMultiple(newAstNodes);
                    replacementMade = true;
                } else {
                     statusCallback?.(`Cannot replace parent of ${targetPathForB.node.type} either (not a statement or no parent?).`, 'error');
                }
            }
          }
        } catch (directReplaceError) {
            // Safe access to targetPathForB.node.type
            statusCallback?.(`Strategy B: Direct replacement of ${targetPathForB.node.type} failed: ${directReplaceError instanceof Error ? directReplaceError.message : String(directReplaceError)}`, 'warning');
            console.error("AST Replacement Error (Strategy B - Direct):", directReplaceError);
            // Fallback: Try replacing the parent statement if direct replacement failed
            if (targetPathForB.parentPath?.isStatement() && targetPathForB.parentPath !== targetPathForB) {
                statusCallback?.(`Strategy B: Attempting to replace parent statement (${targetPathForB.parentPath.node.type})...`, 'info');
                try {
                   // Check again if parent context allows multiple before replacing
                   const parentCanReplaceWithMultiple = targetPathForB.parentPath.parentPath?.isBlockStatement() ||
                                                        targetPathForB.parentPath.parentPath?.isProgram() ||
                                                        targetPathForB.parentPath.inList;
                   if (newAstNodes.length === 1) {
                       targetPathForB.parentPath.replaceWith(newAstNodes[0]);
                       replacementMade = true;
                   } else if (parentCanReplaceWithMultiple) {
                        targetPathForB.parentPath.replaceWithMultiple(newAstNodes);
                        replacementMade = true;
                   } else {
                       statusCallback?.(`Strategy B: Cannot replace parent statement ${targetPathForB.parentPath.node.type} with multiple nodes in this context.`, 'error');
                   }
                } catch (parentReplaceError) {
                     statusCallback?.(`Strategy B: Replacing parent statement failed: ${parentReplaceError instanceof Error ? parentReplaceError.message : String(parentReplaceError)}`, 'error');
                     console.error("AST Replacement Error (Strategy B - Parent):", parentReplaceError);
                }
            } else {
                 statusCallback?.(`Strategy B: No suitable parent statement found to replace.`, 'warning');
            }
        }

        if (replacementMade) {
           statusCallback?.('Strategy B: Targeted replacement successful.', 'success');
        } else {
           statusCallback?.('Strategy B: Targeted replacement attempt failed.', 'error');
        }

      } else if (!replacementMade && newAstNodes.length === 0) {
         // Handle empty snippet -> remove node (errorNodePath is NodePath here)
         statusCallback?.(`New code snippet is empty. Removing target node: ${errorNodePath.node.type}`, 'info');
          try {
              errorNodePath.remove();
              replacementMade = true;
              statusCallback?.('Node removal successful.', 'success');
          } catch (removeError) {
               statusCallback?.(`Error removing node: ${removeError instanceof Error ? removeError.message : String(removeError)}`, 'error');
               console.error("AST Removal Error:", removeError);
          }
      }


      // --- 5. Generate and Write ---
      if (replacementMade) {
          statusCallback?.('Generating updated code from AST...', 'info');
          const output = generate(ast, {
            retainLines: true, // Try to preserve line numbers somewhat
            concise: false,    // Avoid overly compacting code
            // comments: true, // Including comments can be buggy, enable with caution
          }, originalFileContent); // Pass original content for potentially better formatting
          const newContent = output.code;

          statusCallback?.('Writing updated content to file...', 'info');
          const writable = await fileHandle.createWritable();
          await writable.write(newContent);
          await writable.close();

          statusCallback?.('Code fix successfully applied using Babel AST manipulation!', 'success');
          return true; // Success
      } else {
          // If we reach here, neither strategy worked or the snippet was empty and removal failed
          statusCallback?.('Automatic replacement failed after trying multiple strategies. Please apply the fix manually.', 'error');
          await this.copyToClipboard(cleanedNewCode);
          statusCallback?.('Code fix copied to clipboard.', 'warning');
          return false; // Failure
      }

    // --- Catch block for the main try ---
    } catch (error) {
      statusCallback?.(
        `Error applying code fix via Babel: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
      console.error("Error during Babel fix process:", error); // Log full error for debugging
      // Optionally copy to clipboard on error too
      await this.copyToClipboard(cleanedNewCode);
      statusCallback?.('New code copied to clipboard due to error.', 'warning');
      return false; // Failure
    }
    // --- End of catch block ---
  } // End of applyCodeFix function

  /**
   * Applies a code fix using simple string replacement (fallback).
   */
  private async applySimpleFix(
     fileHandle: FileSystemFileHandle,
     originalFileContent: string,
     originalSourceSnippet: string,
     newCodeSnippet: string,
     statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
     const cleanedNewCode = this.cleanCodeExample(newCodeSnippet);
     const cleanedOriginalSnippet = this.cleanCodeExample(originalSourceSnippet);

     if (!cleanedOriginalSnippet) {
         statusCallback?.('Original snippet is empty, cannot perform direct replacement.', 'warning');
         await this.copyToClipboard(cleanedNewCode);
         statusCallback?.('Code fix copied to clipboard.', 'warning');
         return false;
     }

     if (originalFileContent.includes(cleanedOriginalSnippet)) {
        statusCallback?.('Attempting direct string replacement...', 'info');
        const newContent = originalFileContent.replace(cleanedOriginalSnippet, cleanedNewCode);

        try {
            statusCallback?.('Writing updated content (simple replacement)...', 'info');
            const writable = await fileHandle.createWritable();
            await writable.write(newContent);
            await writable.close();
            statusCallback?.('Code fix applied using direct replacement (less reliable).', 'success');
            return true;
        } catch (error) {
             statusCallback?.(
                `Error writing file during simple replacement: ${error instanceof Error ? error.message : String(error)}`,
                'error'
            );
            console.error("Error during Simple Fix write:", error);
        }
      }

      // Last Resort: Copy to clipboard
      statusCallback?.('Direct replacement failed or original snippet not found. Please apply the fix manually.', 'error');
      await this.copyToClipboard(cleanedNewCode);
      statusCallback?.('Code fix copied to clipboard.', 'warning');
      return false;
  }


  // --- Helper Methods ---

  /** Clean code example (removes ``` fences and line numbers) */
  public cleanCodeExample(codeExample: string): string {
     if (!codeExample) return '';
     let cleanCode = codeExample.trim();
     // Updated regex to handle optional language identifiers (like ```javascript) and potential whitespace
     cleanCode = cleanCode.replace(/^```[\w\s]*\n?/m, ''); // Remove starting fence
     cleanCode = cleanCode.replace(/\n?```$/m, ''); // Remove ending fence
     // Regex to remove leading line numbers like "1.", "1 |", "1:", etc. possibly followed by whitespace
     cleanCode = cleanCode.replace(/^\s*\d+\s*[:.|]\s*/gm, '');
     return cleanCode.trim();
  }

  /** Copy to clipboard */
  public async copyToClipboard(text: string): Promise<void> {
    if (!text) return;
    try {
        if (navigator.clipboard && window.isSecureContext) {
             await navigator.clipboard.writeText(text);
        } else {
            // Fallback for insecure contexts or older browsers
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed'; // Prevent scrolling to bottom
            textarea.style.opacity = '0';
            textarea.style.left = '-9999px';
            textarea.style.top = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            try {
                const success = document.execCommand('copy');
                if (!success) {
                   throw new Error('Fallback document.execCommand failed');
                }
            } catch (e) {
                console.error('Fallback clipboard copy failed:', e);
                // Avoid throwing here, let the caller handle UI feedback
            } finally {
               document.body.removeChild(textarea);
            }
        }
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      // Let the calling function decide how to handle clipboard failure via statusCallback.
    }
  }

  /**
   * Helper function to extract names from AST nodes
   * Useful for duplicate detection and function matching
   */
  private extractNodeName(node: t.Node): string | null {
    if (t.isFunctionDeclaration(node) && node.id) {
      return node.id.name;
    } 
    
    if (t.isVariableDeclaration(node) && 
        node.declarations.length > 0 && 
        t.isIdentifier(node.declarations[0].id)) {
      return node.declarations[0].id.name;
    }
    
    if (t.isExportNamedDeclaration(node) && node.declaration) {
      return this.extractNodeName(node.declaration);
    }
    
    if (t.isExportDefaultDeclaration(node) && node.declaration) {
      if (t.isIdentifier(node.declaration)) {
        return node.declaration.name;
      }
      // For anonymous export default, use a special identifier
      return '_default_';
    }
    
    return null;
  }
}

// Export singleton instance (optional, depends on usage)
export const fileService = new FileService();