import { ErrorInfo } from '../types';
import * as parser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';
import { copyToClipboard } from '../utils/code-utils';

/**
 * Core class for handling AST manipulation and code analysis
 */
export class AstProcessor {
  /**
   * Main method to process a code fix using AST manipulation
   */
  public async processCodeFix(
    fileHandle: FileSystemFileHandle,
    originalFileContent: string,
    originalSourceSnippet: string,
    newCodeSnippet: string,
    errorInfo: ErrorInfo,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
    const lineHint = errorInfo.lineNumber || 1;
    const errorName = errorInfo.message ? this.extractErrorIdentifier(errorInfo.message) : null;

    // Log error name for debugging
    if (errorName) {
      statusCallback?.(`Detected error identifier: "${errorName}"`, 'info');
    }

    // --- Start of main try block ---
    try {
      statusCallback?.('Parsing file content with Babel...', 'info');

      // --- 1. Parse the original file content ---
      const ast = parser.parse(originalFileContent, {
        sourceType: 'module',
        plugins: [
          'typescript',
          'jsx',
          'decorators-legacy',
          'classProperties',
          'exportDefaultFrom',
          'doExpressions',
          'optionalChaining',
          'nullishCoalescingOperator'
        ],
        errorRecovery: true,
      });

      // Extract all existing identifiers first for better duplicate detection
      const existingIdentifiers = this.collectExistingIdentifiers(ast);
      statusCallback?.(`Found ${existingIdentifiers.size} named declarations in the file.`, 'info');

      // --- 2. Analyze the error context to determine what exactly is missing ---
      // Find the node containing the error
      let errorNodePath: NodePath | null = null;
      let errorContainingFunction: NodePath | null = null;
      let errorLineBlockPaths: NodePath[] = [];

      traverse(ast, {
        enter: (path) => {
          if (!path.node.loc) return;

          const startLine = path.node.loc.start.line;
          const endLine = path.node.loc.end.line;

          // Collect all nodes containing the error line
          if (lineHint >= startLine && lineHint <= endLine) {
            errorLineBlockPaths.push(path);

            // Specifically look for the function containing the error
            if ((path.isFunctionDeclaration() ||
              path.isFunctionExpression() ||
              path.isArrowFunctionExpression() ||
              path.isObjectMethod() ||
              path.isClassMethod()) &&
              !errorContainingFunction) {
              errorContainingFunction = path;
            }

            // Find the most specific node containing the error line
            if (!errorNodePath || !errorNodePath.node.loc ||
                (endLine - startLine) <
                (errorNodePath.node.loc.end.line - errorNodePath.node.loc.start.line)) {
              errorNodePath = path;
            }
          }
        }
      });

      // Analyze function call graph
      const callGraph = this.analyzeCallGraph(ast);

      // --- 3. Parse the new code snippet into AST nodes ---
      // Try a more robust approach to parsing the new code
      const { parsedNodes, parseError } = this.parseNewCodeSnippet(newCodeSnippet, statusCallback);

      if (parseError || !parsedNodes || parsedNodes.length === 0) {
        // If parsing as a whole fails, try parsing declarations separately
        const { declaredNodes, declareError } = this.parseSeparateDeclarations(newCodeSnippet, statusCallback);

        if (declareError || declaredNodes.length === 0) {
          // All parsing attempts failed
          statusCallback?.('Failed to parse the new code snippet. Trying alternative approach...', 'warning');

          // Try one more time with a custom approach for the specific error type
          if (errorName) {
            const customFixResult = await this.applyCustomFix(
              fileHandle,
              originalFileContent,
              errorName,
              newCodeSnippet,
              errorInfo,
              statusCallback
            );

            if (customFixResult) {
              return true; // Custom fix was successful
            }
          }

          // Last resort - clipboard
          await copyToClipboard(newCodeSnippet);
          statusCallback?.('New code copied to clipboard due to parsing error.', 'warning');
          return false;
        }

        // Use the separately parsed declarations
        statusCallback?.(`Successfully parsed ${declaredNodes.length} separate declarations.`, 'info');

        // Apply selective fix with individual declarations
        return await this.applySelectiveFix(
          fileHandle,
          originalFileContent,
          ast,
          declaredNodes,
          errorInfo,
          errorName,
          statusCallback
        );
      }

      // Successfully parsed the new code as a whole
      statusCallback?.(`Successfully parsed ${parsedNodes.length} AST nodes from new code.`, 'info');

      // -- 4. Determine which parts of the new code are needed --
      const { nodesToAdd, nodesToReplace } = this.identifyNeededNodes(
        ast,
        parsedNodes,
        errorName,
        existingIdentifiers,
        errorContainingFunction,
        statusCallback
      );

      if (nodesToAdd.length === 0 && nodesToReplace.size === 0) {
        statusCallback?.('No unique declarations to add or replace were identified.', 'warning');
        await copyToClipboard(newCodeSnippet);
        statusCallback?.('Code fix copied to clipboard.', 'warning');
        return false;
      }

      // --- 5. Apply the identified fixes ---
      // First handle replacements
      let replacementsMade = 0;
      for (const [pathToReplace, replacementNode] of nodesToReplace.entries()) {
        try {
          pathToReplace.replaceWith(replacementNode);
          replacementsMade++;
        } catch (replaceError) {
          statusCallback?.(
            `Error replacing node: ${replaceError instanceof Error ? replaceError.message : String(replaceError)}`,
            'warning'
          );
        }
      }

      // Then handle additions
      let additionsMade = 0;
      if (nodesToAdd.length > 0) {
        additionsMade = await this.addNewNodes(ast, nodesToAdd, errorInfo, statusCallback);
      }

      const anyChangesMade = replacementsMade > 0 || additionsMade > 0;

      if (anyChangesMade) {
        // Generate the updated file content
        statusCallback?.('Generating updated code from AST...', 'info');
        const output = generate(ast, {
          concise: false,
          compact: false,
          jsescOption: {
            minimal: true
          },
          minified: false,
        }, originalFileContent);

        // Write the updated content back to the file
        statusCallback?.('Writing updated content to file...', 'info');
        const writable = await fileHandle.createWritable();
        await writable.write(output.code);
        await writable.close();

        statusCallback?.(
          `Code fix successfully applied! (${replacementsMade} replacements, ${additionsMade} additions)`,
          'success'
        );
        return true;
      } else {
        // Fallback approach
        statusCallback?.('Standard approaches failed. Attempting direct insertion of missing identifier...', 'warning');

        if (errorName) {
          const fallbackResult = await this.applyFallbackFix(
            fileHandle,
            originalFileContent,
            errorName,
            newCodeSnippet,
            errorInfo,
            statusCallback
          );

          if (fallbackResult) {
            return true;
          }
        }

        // Last resort - clipboard
        statusCallback?.('All automatic fix attempts failed.', 'error');
        await copyToClipboard(newCodeSnippet);
        statusCallback?.('Code fix copied to clipboard.', 'warning');
        return false;
      }
    } catch (error) {
      statusCallback?.(
        `Error applying code fix via Babel: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
      console.error("Error during Babel fix process:", error);

      // Fallback on error
      if (errorName) {
        const fallbackResult = await this.applyFallbackFix(
          fileHandle,
          originalFileContent,
          errorName,
          newCodeSnippet,
          errorInfo,
          statusCallback
        );

        if (fallbackResult) {
          return true;
        }
      }

      // Clipboard as final resort
      await copyToClipboard(newCodeSnippet);
      statusCallback?.('New code copied to clipboard due to error.', 'warning');
      return false;
    }
  }

  /**
   * Parse the new code snippet into AST nodes
   */
  private parseNewCodeSnippet(
    code: string,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): { parsedNodes: t.Statement[] | null, parseError: Error | null } {
    let parsedNodes: t.Statement[] | null = null;
    let parseError: Error | null = null;

    try {
      // Try parsing as a complete program
      const newAst = parser.parse(code, {
        sourceType: 'module',
        plugins: [
          'typescript',
          'jsx',
          'decorators-legacy',
          'classProperties',
          'exportDefaultFrom',
          'doExpressions',
          'optionalChaining',
          'nullishCoalescingOperator'
        ],
        allowReturnOutsideFunction: true,
        errorRecovery: true,
      });

      parsedNodes = newAst.program.body;

      // Handle empty body or only directives
      if (parsedNodes.length === 0 && newAst.program.directives.length > 0) {
        parsedNodes = newAst.program.directives.map(dir =>
          t.expressionStatement(t.stringLiteral(dir.value.value))
        );
      }

      if (parsedNodes.length === 0) {
        statusCallback?.('Parsed AST has no statements.', 'warning');
      }
    } catch (error) {
      parseError = error instanceof Error ? error : new Error(String(error));
      statusCallback?.(`Error parsing code as program: ${parseError.message}`, 'warning');

      // Try parsing as an expression
      try {
        const expressionNode = parser.parseExpression(code, {
          plugins: ['typescript', 'jsx']
        });

        parsedNodes = [t.expressionStatement(expressionNode)];
        parseError = null; // Clear error since we succeeded
      } catch (expressionError) {
        // Keep the original error since both approaches failed
        statusCallback?.(`Also failed to parse as expression: ${expressionError instanceof Error ? expressionError.message : String(expressionError)}`, 'warning');
      }
    }

    return { parsedNodes, parseError };
  }

  /**
   * Parse separate declarations from the code snippet
   */
  private parseSeparateDeclarations(
    code: string,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): { declaredNodes: t.Statement[], declareError: Error | null } {
    const declaredNodes: t.Statement[] = [];
    let declareError: Error | null = null;

    // Split the code into potential separate declarations
    const lines = code.split('\n');
    let currentDeclaration = '';
    let braceCount = 0;
    let inString = false;
    let stringChar = '';

    // Process line by line to identify complete declarations
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      currentDeclaration += line + '\n';

      // Count braces and track string contexts to detect declaration boundaries
      for (let j = 0; j < line.length; j++) {
        const char = line[j];

        // Handle string context
        if ((char === '"' || char === "'" || char === '`') &&
          (j === 0 || line[j - 1] !== '\\')) {
          if (!inString) {
            inString = true;
            stringChar = char;
          } else if (char === stringChar) {
            inString = false;
          }
        }

        // Only count braces outside of strings
        if (!inString) {
          if (char === '{') braceCount++;
          if (char === '}') braceCount--;
        }
      }

      // Check for potential declaration boundaries
      const isExportStatement = currentDeclaration.trim().startsWith('export');
      const isConstOrLetOrVar = /^\s*(const|let|var)\s+/.test(currentDeclaration.trim());
      const isFunctionDeclaration = /^\s*function\s+\w+/.test(currentDeclaration.trim());
      const isClassDeclaration = /^\s*class\s+\w+/.test(currentDeclaration.trim());
      const isInterfaceDeclaration = /^\s*interface\s+\w+/.test(currentDeclaration.trim());
      const isTypeDeclaration = /^\s*type\s+\w+/.test(currentDeclaration.trim());

      const isPotentialDeclaration = isExportStatement || isConstOrLetOrVar ||
        isFunctionDeclaration || isClassDeclaration ||
        isInterfaceDeclaration || isTypeDeclaration;

      // If we detected a declaration boundary and braces are balanced, try to parse it
      if (isPotentialDeclaration && braceCount <= 0 && currentDeclaration.trim().length > 0) {
        const declarationCode = currentDeclaration.trim();

        // Try to parse this single declaration
        try {
          const { parsedNodes, parseError } = this.parseNewCodeSnippet(declarationCode, statusCallback);

          if (!parseError && parsedNodes && parsedNodes.length > 0) {
            // Add all successfully parsed nodes
            parsedNodes.forEach(node => declaredNodes.push(node));
          }
        } catch (error) {
          // Just log and continue with next declaration
          console.error(`Error parsing declaration: ${declarationCode}`, error);
        }

        // Reset for next declaration
        currentDeclaration = '';
        braceCount = 0;
      }
    }

    // Try to parse any remaining code
    if (currentDeclaration.trim().length > 0) {
      try {
        const { parsedNodes, parseError } = this.parseNewCodeSnippet(currentDeclaration, statusCallback);

        if (!parseError && parsedNodes && parsedNodes.length > 0) {
          parsedNodes.forEach(node => declaredNodes.push(node));
        }
      } catch (error) {
        declareError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // Return all successfully parsed declarations
    return { declaredNodes, declareError };
  }

  /**
   * Extract the error identifier from an error message
   */
  private extractErrorIdentifier(errorMessage: string): string | null {
    // Common patterns for different error types
    const patterns = [
      /(?:ReferenceError|TypeError):\s+(\w+)\s+is not defined/i,
      /Cannot read (?:property|properties) '(\w+)' of/i,
      /(\w+) is not a function/i,
      /Identifier '(\w+)' has already been declared/i,
      /(\w+) is not recognized/i,
      /cannot find name '(\w+)'/i
    ];

    for (const pattern of patterns) {
      const match = errorMessage.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Apply a selective fix with only the necessary nodes
   */
  private async applySelectiveFix(
    fileHandle: FileSystemFileHandle,
    originalFileContent: string,
    ast: parser.ParseResult<t.File>,
    declaredNodes: t.Statement[],
    errorInfo: ErrorInfo,
    errorName: string | null,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
    // If we have an error name, filter for only the relevant declarations
    let relevantNodes: t.Statement[] = [];

    if (errorName) {
      // First try to find exactly the declaration for the error name
      const exactMatch = declaredNodes.find(node => {
        const nodeName = this.extractNodeName(node);
        return nodeName === errorName;
      });

      if (exactMatch) {
        relevantNodes = [exactMatch];
        statusCallback?.(`Found exact declaration for "${errorName}".`, 'info');
      } else {
        // Look for any node that references the error name
        relevantNodes = declaredNodes.filter(node => {
          let referencesError = false;
          traverse(t.file(t.program([node])), {
            Identifier(path) {
              if (path.node.name === errorName) {
                referencesError = true;
                path.stop();
              }
            }
          });
          return referencesError;
        });

        if (relevantNodes.length > 0) {
          statusCallback?.(`Found ${relevantNodes.length} declarations referencing "${errorName}".`, 'info');
        } else {
          // No references found, fall back to all declarations
          relevantNodes = declaredNodes;
          statusCallback?.(`No declarations referencing "${errorName}" found. Using all declarations.`, 'warning');
        }
      }
    } else {
      // No error name to filter by, use all declarations
      relevantNodes = declaredNodes;
    }

    // Identify which nodes already exist and need replacement vs. which are new
    const existingNodePaths = new Map<string, NodePath>();
    const nodesToAdd: t.Statement[] = [];
    const nodesToReplace = new Map<NodePath, t.Statement>();

    // Collect existing node paths
    traverse(ast, {
      enter: (path) => {
        const nodeName = this.extractNodeName(path.node);
        if (nodeName && !existingNodePaths.has(nodeName)) {
          existingNodePaths.set(nodeName, path);
        }
      }
    });

    // Determine which nodes to add vs. replace
    for (const node of relevantNodes) {
      const nodeName = this.extractNodeName(node);

      if (!nodeName) {
        // Anonymous node, always add
        nodesToAdd.push(node);
        continue;
      }

      if (existingNodePaths.has(nodeName)) {
        // Node exists, compare code to see if it's different
        const existingPath = existingNodePaths.get(nodeName)!;
        const existingCode = this.generateCodeForNode(existingPath.node);
        const newCode = this.generateCodeForNode(node);

        if (!this.areNodesEquivalent(existingCode, newCode)) {
          // Different implementation, replace
          nodesToReplace.set(existingPath, node);
        }
        // Else: identical declaration, skip
      } else {
        // New node, add
        nodesToAdd.push(node);
      }
    }

    // Apply the changes
    let changesMade = false;

    // First handle replacements
    let replacementsMade = 0;
    for (const [pathToReplace, replacementNode] of nodesToReplace.entries()) {
      try {
        pathToReplace.replaceWith(replacementNode);
        replacementsMade++;
        changesMade = true;
      } catch (replaceError) {
        statusCallback?.(
          `Error replacing node: ${replaceError instanceof Error ? replaceError.message : String(replaceError)}`,
          'warning'
        );
      }
    }

    // Then handle additions
    let additionsMade = 0;
    if (nodesToAdd.length > 0) {
      additionsMade = await this.addNewNodes(ast, nodesToAdd, errorInfo, statusCallback);
      if (additionsMade > 0) {
        changesMade = true;
      }
    }

    if (changesMade) {
      // Generate and write the updated file
      statusCallback?.('Generating updated code from AST...', 'info');
      const output = generate(ast, {
        concise: false,
        compact: false,
        jsescOption: {
          minimal: true
        },
        minified: false,
      }, originalFileContent);

      statusCallback?.('Writing updated content to file...', 'info');
      const writable = await fileHandle.createWritable();
      await writable.write(output.code);
      await writable.close();

      statusCallback?.(
        `Code fix successfully applied! (${replacementsMade} replacements, ${additionsMade} additions)`,
        'success'
      );
      return true;
    } else {
      // No changes made with this approach
      statusCallback?.('No changes applied with selective fix approach.', 'warning');
      return false;
    }
  }

  /**
   * Identify which nodes from the new code are needed to fix the error
   */
  private identifyNeededNodes(
    ast: parser.ParseResult<t.File>,
    newNodes: t.Statement[],
    errorName: string | null,
    existingIdentifiers: Set<string>,
    errorContainingFunction: NodePath | null,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): {
    nodesToAdd: t.Statement[],
    nodesToReplace: Map<NodePath, t.Statement>
  } {
    const nodesToAdd: t.Statement[] = [];
    const nodesToReplace = new Map<NodePath, t.Statement>();

    // If we have an error name, prioritize nodes that define that identifier
    if (errorName) {
      statusCallback?.(`Looking for declarations of "${errorName}" in the new code...`, 'info');

      // First pass: look for exact matches to the error identifier
      for (const node of newNodes) {
        const nodeName = this.extractNodeName(node);

        if (nodeName === errorName) {
          statusCallback?.(`Found declaration for "${errorName}" in new code.`, 'info');

          // Check if this identifier already exists (possible duplicate)
          if (existingIdentifiers.has(nodeName)) {
            statusCallback?.(`Warning: "${nodeName}" is already declared in the file.`, 'warning');

            // Find the existing declaration to replace it
            let existingPath: NodePath | null = null;

            traverse(ast, {
              enter: (path) => {
                if (existingPath) return;
                const pathNodeName = this.extractNodeName(path.node);
                if (pathNodeName === nodeName) {
                  existingPath = path;
                  path.stop();
                }
              }
            });

            if (existingPath) {
              statusCallback?.(`Will replace existing declaration of "${nodeName}".`, 'info');
              nodesToReplace.set(existingPath, node);
            } else {
              // Strange case - identifier exists but declaration not found
              statusCallback?.(`Identifier exists but declaration not found. Will add as new.`, 'warning');
              nodesToAdd.push(node);
            }
          } else {
            // New identifier, just add it
            nodesToAdd.push(node);
          }

          // We found and handled the error identifier, no need to check more
          return { nodesToAdd, nodesToReplace };
        }
      }

      // Second pass: look for any node that mentions the error identifier
      for (const node of newNodes) {
        let mentionsError = false;

        // Analyze the node to see if it mentions the error identifier
        traverse(t.file(t.program([node])), {
          Identifier(path) {
            if (path.node.name === errorName) {
              mentionsError = true;
              path.stop();
            }
          }
        });

        if (mentionsError) {
          const nodeName = this.extractNodeName(node);
          statusCallback?.(`Found node referencing "${errorName}": ${nodeName || '[anonymous]'}`, 'info');

          // Check for duplicates as above
          if (nodeName && existingIdentifiers.has(nodeName)) {
            let existingPath: NodePath | null = null;

            traverse(ast, {
              enter: (path) => {
                if (existingPath) return;
                const pathNodeName = this.extractNodeName(path.node);
                if (pathNodeName === nodeName) {
                  existingPath = path;
                  path.stop();
                }
              }
            });

            if (existingPath) {
              nodesToReplace.set(existingPath, node);
            } else {
              nodesToAdd.push(node);
            }
          } else {
            nodesToAdd.push(node);
          }
        }
      }
    }

    // If we haven't found anything yet, use a broader approach
    if (nodesToAdd.length === 0 && nodesToReplace.size === 0) {
      // Identify missing vs. existing declarations
      for (const node of newNodes) {
        const nodeName = this.extractNodeName(node);

        if (!nodeName) {
          // Anonymous declarations, add if they seem relevant
          if (this.isNodeRelevantToError(node, errorName, errorContainingFunction)) {
            nodesToAdd.push(node);
          }
          continue;
        }

        if (existingIdentifiers.has(nodeName)) {
          // Find the existing declaration
          let existingPath: NodePath | null = null;

          traverse(ast, {
            enter: (path) => {
              if (existingPath) return;
              const pathNodeName = this.extractNodeName(path.node);
              if (pathNodeName === nodeName) {
                existingPath = path;
                path.stop();
              }
            }
          });

          if (existingPath) {
            // Check if the contents are different before deciding to replace
            const typedExistingPath = existingPath as unknown as { node: t.Node };
            const existingCode = this.generateCodeForNode(typedExistingPath.node);
            const newCode = this.generateCodeForNode(node);

            if (!this.areNodesEquivalent(existingCode, newCode)) {
              nodesToReplace.set(existingPath, node);
            }
            // Else: skip identical declarations
          } else {
            // Strange case - add anyway
            nodesToAdd.push(node);
          }
        } else {
          // New declaration, add if it seems relevant
          if (this.isNodeRelevantToError(node, errorName, errorContainingFunction)) {
            nodesToAdd.push(node);
          }
        }
      }
    }

    return { nodesToAdd, nodesToReplace };
  }

  /**
   * Determine if a node is relevant to fixing the current error
   */
  private isNodeRelevantToError(
    node: t.Node,
    errorName: string | null,
    errorContainingFunction: NodePath | null
  ): boolean {
    // Without error context, consider all nodes relevant
    if (!errorName && !errorContainingFunction) {
      return true;
    }

    // Check if node mentions the error name
    if (errorName) {
      let mentionsError = false;
      traverse(t.file(t.program([node as t.Statement])), {
        Identifier(path) {
          if (path.node.name === errorName) {
            mentionsError = true;
            path.stop();
          }
        }
      });

      if (mentionsError) {
        return true;
      }
    }

    // Check if this node is structurally similar to the error-containing function
    if (errorContainingFunction &&
      (t.isFunctionDeclaration(node) ||
        t.isFunctionExpression(node) ||
        t.isArrowFunctionExpression(node))) {
      // You could implement structural similarity analysis here
      // For now, consider all functions potentially relevant
      return true;
    }

    // Default to considering it relevant
    return true;
  }

  /**
   * Add new nodes to the AST in appropriate locations
   */
  private async addNewNodes(
    ast: parser.ParseResult<t.File>,
    nodesToAdd: t.Statement[],
    errorInfo: ErrorInfo,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<number> {
    let additionsMade = 0;

    // Find the program node
    let programPath: NodePath | null = null;
    traverse(ast, {
      Program(path) {
        programPath = path;
        path.stop();
      }
    });

    if (!programPath) {
      statusCallback?.('Could not find program node to add declarations.', 'error');
      return 0;
    }

    // Categorize nodes by type
    const exportNodes: t.Statement[] = [];
    const functionNodes: t.Statement[] = [];
    const varNodes: t.Statement[] = [];
    const otherNodes: t.Statement[] = [];

    for (const node of nodesToAdd) {
      if (t.isExportDeclaration(node)) {
        exportNodes.push(node);
      } else if (t.isFunctionDeclaration(node)) {
        functionNodes.push(node);
      } else if (t.isVariableDeclaration(node)) {
        varNodes.push(node);
      } else {
        otherNodes.push(node);
      }
    }

    // Try to insert each category in appropriate locations
    try {
      // Add type assertion to programPath
      const program = programPath as unknown as { node: { body: Array<any> } };

      // Find the last existing export to insert export nodes after it
      let lastExportIndex = -1;
      for (let i = 0; i < program.node.body.length; i++) {
        if (t.isExportDeclaration(program.node.body[i])) {
          lastExportIndex = i;
        }
      }

      // Find a good position for function declarations
      let functionInsertIndex = -1;
      for (let i = 0; i < program.node.body.length; i++) {
        if (t.isFunctionDeclaration(program.node.body[i])) {
          functionInsertIndex = i;
          // Don't break - find the last one
        }
      }

      // If no functions found, look for variable declarations
      if (functionInsertIndex === -1) {
        for (let i = 0; i < program.node.body.length; i++) {
          if (t.isVariableDeclaration(program.node.body[i])) {
            functionInsertIndex = i;
            // Don't break - find the last one
          }
        }
      }

      // Determine insert positions based on above analysis
      const exportInsertIndex = lastExportIndex !== -1 ? lastExportIndex + 1 : program.node.body.length;
      const functionInsertPos = functionInsertIndex !== -1 ? functionInsertIndex + 1 :
        (exportInsertIndex > 0 ? exportInsertIndex : 0);
      const varInsertPos = functionInsertPos;

      // Try to insert near the error line if possible
      const errorLine = errorInfo.lineNumber || 0;
      let nearErrorInsertIndex = -1;

      if (errorLine > 0) {
        let minDistance = Infinity;
        for (let i = 0; i < program.node.body.length; i++) {
          const node = program.node.body[i];
          if (node.loc) {
            const distance = Math.abs(node.loc.start.line - errorLine);
            if (distance < minDistance) {
              minDistance = distance;
              nearErrorInsertIndex = i;
            }
          }
        }
      }

      // If we found a node near the error line, use that position
      const otherInsertPos = nearErrorInsertIndex !== -1 ? nearErrorInsertIndex + 1 :
        (functionInsertPos > 0 ? functionInsertPos : 0);

      // Now insert the nodes in appropriate positions
      // Insert exports at export position
      if (exportNodes.length > 0) {
        program.node.body.splice(exportInsertIndex, 0, ...exportNodes);
        additionsMade += exportNodes.length;
        statusCallback?.(`Added ${exportNodes.length} export declarations.`, 'info');
      }

      // Insert functions at function position
      if (functionNodes.length > 0) {
        program.node.body.splice(functionInsertPos, 0, ...functionNodes);
        additionsMade += functionNodes.length;
        statusCallback?.(`Added ${functionNodes.length} function declarations.`, 'info');
      }

      // Insert vars at var position
      if (varNodes.length > 0) {
        program.node.body.splice(varInsertPos, 0, ...varNodes);
        additionsMade += varNodes.length;
        statusCallback?.(`Added ${varNodes.length} variable declarations.`, 'info');
      }

      // Insert other nodes at other position
      if (otherNodes.length > 0) {
        program.node.body.splice(otherInsertPos, 0, ...otherNodes);
        additionsMade += otherNodes.length;
        statusCallback?.(`Added ${otherNodes.length} other declarations.`, 'info');
      }
    } catch (error) {
      statusCallback?.(
        `Error adding nodes: ${error instanceof Error ? error.message : String(error)}`,
        'error'
      );
      console.error("Node addition error:", error);
    }

    return additionsMade;
  }

  /**
   * Apply a custom fix for specific error types
   */
  private async applyCustomFix(
    fileHandle: FileSystemFileHandle,
    originalFileContent: string,
    errorName: string,
    newCodeSnippet: string,
    errorInfo: ErrorInfo,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
    statusCallback?.(`Attempting custom fix for "${errorName}" error...`, 'info');

    // Look for patterns in the new code related to the error name
    const errorNamePattern = new RegExp(`(const|let|var|function)\\s+${errorName}\\s*=\\s*[^;]+`, 'i');
    const match = newCodeSnippet.match(errorNamePattern);

    if (match && match[0]) {
      const declaration = match[0];
      statusCallback?.(`Found declaration for "${errorName}" in new code.`, 'info');

      // Try to insert just before the error line
      const lineHint = errorInfo.lineNumber || 1;
      const contentLines = originalFileContent.split('\n');

      // Find a good line to insert the declaration
      // Try to find a reasonable spot before the error line
      let insertLineIndex = lineHint - 1;

      // Look for a blank line or a line ending with a closing brace
      let bestInsertSpot = -1;
      for (let i = insertLineIndex; i >= 0; i--) {
        const line = contentLines[i].trim();
        if (line === '' || line.endsWith('}')) {
          bestInsertSpot = i + 1;
          break;
        }
      }

      // If no good spot found, just insert right before the error line
      if (bestInsertSpot === -1) {
        bestInsertSpot = Math.max(0, insertLineIndex);
      }

      // Add the declaration with a newline after it
      contentLines.splice(bestInsertSpot, 0, declaration + ';');

      // Write the updated content
      try {
        const updatedContent = contentLines.join('\n');
        const writable = await fileHandle.createWritable();
        await writable.write(updatedContent);
        await writable.close();

        statusCallback?.(`Custom fix successfully applied for "${errorName}".`, 'success');
        return true;
      } catch (writeError) {
        statusCallback?.(
          `Error writing file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
          'error'
        );
        return false;
      }
    }

    // Try another approach - extract just a function definition
    const functionPattern = new RegExp(`(const|function)\\s+${errorName}\\s*=?\\s*\\([^)]*\\)\\s*=>?\\s*{[\\s\\S]*?}`, 'i');
    const functionMatch = newCodeSnippet.match(functionPattern);

    if (functionMatch && functionMatch[0]) {
      const functionDef = functionMatch[0];
      statusCallback?.(`Found function definition for "${errorName}" in new code.`, 'info');

      // Try to insert at a good spot in the file
      const contentLines = originalFileContent.split('\n');

      // Look for the last function definition or export
      let bestInsertSpot = -1;
      for (let i = contentLines.length - 1; i >= 0; i--) {
        const line = contentLines[i].trim();
        if (line.startsWith('function') ||
          line.startsWith('const') ||
          line.startsWith('let') ||
          line.startsWith('var') ||
          line.startsWith('export')) {
          // Found a declaration, now find where it ends
          let j = i;
          let braceCount = 0;
          let foundStart = false;

          while (j < contentLines.length) {
            const currentLine = contentLines[j];

            // Count braces to track code blocks
            for (const char of currentLine) {
              if (char === '{') {
                foundStart = true;
                braceCount++;
              } else if (char === '}') {
                braceCount--;
              }
            }

            // If braces are balanced after finding an opening brace, we've found the end
            if (foundStart && braceCount <= 0) {
              bestInsertSpot = j + 1;
              break;
            }

            j++;
          }

          if (bestInsertSpot !== -1) {
            break;
          }
        }
      }

      // If no good spot found, just append to the end
      if (bestInsertSpot === -1) {
        bestInsertSpot = contentLines.length;
      }

      // Add the function definition with newlines around it
      contentLines.splice(bestInsertSpot, 0, '', functionDef, '');

      // Write the updated content
      try {
        const updatedContent = contentLines.join('\n');
        const writable = await fileHandle.createWritable();
        await writable.write(updatedContent);
        await writable.close();

        statusCallback?.(`Custom function fix successfully applied for "${errorName}".`, 'success');
        return true;
      } catch (writeError) {
        statusCallback?.(
          `Error writing file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
          'error'
        );
        return false;
      }
    }

    // No match found for custom fix
    statusCallback?.(`No suitable pattern found for custom fix of "${errorName}".`, 'warning');
    return false;
  }

  /**
   * Apply a fallback fix by directly adding a minimal implementation
   */
  private async applyFallbackFix(
    fileHandle: FileSystemFileHandle,
    originalFileContent: string,
    errorName: string,
    newCodeSnippet: string,
    errorInfo: ErrorInfo,
    statusCallback?: (message: string, type: 'info' | 'success' | 'error' | 'warning') => void
  ): Promise<boolean> {
    statusCallback?.(`Applying fallback fix for "${errorName}"...`, 'info');

    // Create a minimal declaration for the missing identifier
    let minimalDeclaration: string;

    // Try to extract from the new code first
    const errorNamePattern = new RegExp(`(const|let|var|function)\\s+${errorName}\\s*=?\\s*\\(?[^{]*\\)?\\s*=>?\\s*{[\\s\\S]*?}`, 'i');
    const match = newCodeSnippet.match(errorNamePattern);

    if (match && match[0]) {
      minimalDeclaration = match[0];
    } else {
      // Create a stub implementation
      minimalDeclaration = `// Define the ${errorName}
const ${errorName} = () => {
  console.log("This is a defined function now.");
};`;
    }

    // Find a good spot to insert the declaration
    const contentLines = originalFileContent.split('\n');

    // Try inserting just before existing exports at the end
    let insertPosition = contentLines.length;
    for (let i = contentLines.length - 1; i >= 0; i--) {
      const line = contentLines[i].trim();
      if (line.startsWith('export ')) {
        insertPosition = i;
        break;
      }
    }

    // Insert the declaration
    contentLines.splice(insertPosition, 0, '', minimalDeclaration, '');

    // Write the updated content
    try {
      const updatedContent = contentLines.join('\n');
      const writable = await fileHandle.createWritable();
      await writable.write(updatedContent);
      await writable.close();

      statusCallback?.(`Fallback fix successfully applied for "${errorName}".`, 'success');
      return true;
    } catch (writeError) {
      statusCallback?.(
        `Error writing file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
        'error'
      );
      return false;
    }
  }

  /**
   * Enhanced node name extraction from AST nodes
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

    // Extract name for arrow functions in variable declarations
    if (t.isVariableDeclarator(node) && t.isIdentifier(node.id)) {
      return node.id.name;
    }

    return null;
  }

  /**
   * Analyze function call relationships to identify connected functions
   */
  private analyzeCallGraph(ast: any): Map<string, Set<string>> {
    const callGraph = new Map<string, Set<string>>();

    // First pass: collect all function names
    traverse(ast, {
      FunctionDeclaration: (path) => {
        if (path.node.id) {
          callGraph.set(path.node.id.name, new Set());
        }
      },
      VariableDeclarator: (path) => {
        if (t.isIdentifier(path.node.id) &&
          (t.isFunctionExpression(path.node.init) || t.isArrowFunctionExpression(path.node.init))) {
          callGraph.set(path.node.id.name, new Set());
        }
      }
    });

    // Second pass: identify function calls
    traverse(ast, {
      CallExpression: (path) => {
        if (t.isIdentifier(path.node.callee)) {
          const callerFunction = this.findEnclosingFunctionName(path);
          const calleeName = path.node.callee.name;

          if (callerFunction && callGraph.has(callerFunction) && callGraph.has(calleeName)) {
            callGraph.get(callerFunction)?.add(calleeName);
          }
        }
      }
    });

    return callGraph;
  }

  /**
   * Find the name of the function enclosing a given path
   */
  private findEnclosingFunctionName(path: NodePath): string | null {
    let currentPath = path;
    while (currentPath.parentPath) {
      currentPath = currentPath.parentPath;

      if (t.isFunctionDeclaration(currentPath.node) && currentPath.node.id) {
        return currentPath.node.id.name;
      }

      if (t.isVariableDeclarator(currentPath.node) &&
        t.isIdentifier(currentPath.node.id) &&
        (t.isFunctionExpression(currentPath.node.init) || t.isArrowFunctionExpression(currentPath.node.init))) {
        return currentPath.node.id.name;
      }
    }

    return null;
  }

  /**
   * Collect all existing identifiers in the AST to avoid duplications
   */
  private collectExistingIdentifiers(ast: parser.ParseResult<t.File>): Set<string> {
    const identifiers = new Set<string>();

    traverse(ast, {
      // Check variable declarations
      VariableDeclarator(path) {
        if (t.isIdentifier(path.node.id)) {
          identifiers.add(path.node.id.name);
        }
      },
      // Check function declarations
      FunctionDeclaration(path) {
        if (path.node.id && t.isIdentifier(path.node.id)) {
          identifiers.add(path.node.id.name);
        }
      },
      // Check class declarations
      ClassDeclaration(path) {
        if (path.node.id && t.isIdentifier(path.node.id)) {
          identifiers.add(path.node.id.name);
        }
      },
      // Check export named declarations
      ExportNamedDeclaration(path) {
        if (path.node.declaration) {
          if (t.isFunctionDeclaration(path.node.declaration) &&
            path.node.declaration.id &&
            t.isIdentifier(path.node.declaration.id)) {
            identifiers.add(path.node.declaration.id.name);
          } else if (t.isVariableDeclaration(path.node.declaration)) {
            path.node.declaration.declarations.forEach(decl => {
              if (t.isIdentifier(decl.id)) {
                identifiers.add(decl.id.name);
              }
            });
          } else if (t.isClassDeclaration(path.node.declaration) &&
            path.node.declaration.id &&
            t.isIdentifier(path.node.declaration.id)) {
            identifiers.add(path.node.declaration.id.name);
          }
        }
        // Also check named exports
        if (path.node.specifiers) {
          path.node.specifiers.forEach(specifier => {
            if (t.isExportSpecifier(specifier) && t.isIdentifier(specifier.exported)) {
              identifiers.add(specifier.exported.name);
            }
          });
        }
      },
      // Check identifiers in any context (referenced variables)
      Identifier(path) {
        // Only collect top-level identifiers or those used in declarations
        if (path.parent &&
          (t.isVariableDeclarator(path.parent) ||
            t.isFunctionDeclaration(path.parent) ||
            t.isClassDeclaration(path.parent))) {
          identifiers.add(path.node.name);
        }
      }
    });

    return identifiers;
  }

  /**
   * Compare two AST nodes to determine if they are functionally equivalent
   */
  private areNodesEquivalent(codeA: string, codeB: string): boolean {
    // More accurate comparison by normalizing whitespace and formatting
    const normalizeCode = (code: string) => {
      return code
        .trim()
        .replace(/\s+/g, ' ')           // Normalize whitespace
        .replace(/;\s*}/g, '}')         // Normalize semicolons before closing brackets
        .replace(/\(\s*\)/g, '()')      // Normalize empty parentheses
        .replace(/{\s*}/g, '{}')        // Normalize empty blocks
        .replace(/\/\/.*$/gm, '')       // Remove comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
        .trim();
    };

    return normalizeCode(codeA) === normalizeCode(codeB);
  }

  /**
   * Generate code string from an AST node for comparison
   */
  private generateCodeForNode(node: any): string {
    try {
      const output = generate(node, {
        comments: false,
        compact: true
      });
      return output.code;
    } catch (error) {
      console.error('Error generating code for node:', error);
      return '';
    }
  }
}