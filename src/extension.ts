import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {

    console.log('Intelligent Build Navigator is active!');

    const provider = vscode.languages.registerDefinitionProvider(
        { language: 'xml' },
        {
            /* The main "router" for Go to Definition. It checks what the user is clicking on and calls the correct handler. */
            async provideDefinition(document, position, token): Promise<vscode.DefinitionLink[] | undefined> {
                
                // Check for <Expand Name="...">
                let definition = await findExpandDefinition(document, position, token);
                if (definition) {
                    return definition;
                }

                // Check for <Include Script="...">
                definition = await findIncludeDefinition(document, position);
                if (definition) {
                    return definition;
                }

                // Check for $(VariableName)
                definition = await findVariableDefinition(document, position, token);
                if (definition) {
                    return definition;
                }

                // Nothing found
                return undefined;
            }
        }
    );

    context.subscriptions.push(provider);
}

export function deactivate() { }

/* Handles Go to Definition for <Expand Name="MacroName">. Jumps to the <Macro Name="MacroName"> definition. */
async function findExpandDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.DefinitionLink[] | undefined> {
    const lineText = document.lineAt(position.line).text;
    const expandRegex = /<Expand\s+[^>]*Name="([^"]+)"/gi;
    let match;

    while ((match = expandRegex.exec(lineText)) !== null) {
        const macroName = match[1];
        const nameStartIndexInTag = match[0].lastIndexOf(macroName); 
        const nameStartIndexInLine = match.index + nameStartIndexInTag;
        const nameEndIndexInLine = nameStartIndexInLine + macroName.length;
        
        if (position.character >= nameStartIndexInLine && position.character <= nameEndIndexInLine) {
            
            console.log(`Searching for Macro: ${macroName}`);
            
            const dependencies = new Set<string>();
            await findFileDependencies(document.uri, dependencies, token);
            if (token.isCancellationRequested) return;

            const escapedName = macroName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const macroRegex = new RegExp(`<Macro\\s+[^>]*Name="${escapedName}"`, 'i');

            for (const filePath of dependencies) {
                const fileUri = vscode.Uri.file(filePath);
                const fileDoc = await vscode.workspace.openTextDocument(fileUri);
                const fileText = fileDoc.getText();
                const macroMatch = macroRegex.exec(fileText);

                if (macroMatch) {
                    console.log(`Macro definition found in: ${fileUri.fsPath}`);
                    
                    // Create DefinitionLink for "Peek"
                    const originRange = new vscode.Range(
                        position.line, nameStartIndexInLine,
                        position.line, nameEndIndexInLine
                    );

                    const targetPos = fileDoc.positionAt(macroMatch.index);
                    const targetLine = fileDoc.lineAt(targetPos.line);
                    const targetRange = targetLine.range;

                    return [{
                        originSelectionRange: originRange,
                        targetUri: fileUri,
                        targetRange: targetRange
                    }];
                }
            }
            console.log(`No Macro definition found for ${macroName}`);
            return undefined;
        }
    }
    return undefined;
}

/* Handles Go to Definition for <Include Script="File.xml">. Jumps to the included file. */
async function findIncludeDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.DefinitionLink[] | undefined> {
    const lineText = document.lineAt(position.line).text;
    const includeRegex = /<Include\s+Script="([^"]+)"/gi;
    let match;

    while ((match = includeRegex.exec(lineText)) !== null) {
        const filename = match[1];
        const filenameStartIndexInTag = match[0].lastIndexOf(filename);
        const filenameStartIndexInLine = match.index + filenameStartIndexInTag;
        const filenameEndIndexInLine = filenameStartIndexInLine + filename.length;

        if (position.character >= filenameStartIndexInLine && position.character <= filenameEndIndexInLine) {
            
            console.log(`Found include script: ${filename}`);
            const currentDir = path.dirname(document.uri.fsPath);
            const includePath = path.resolve(currentDir, filename);

            try {
                const includeUri = vscode.Uri.file(includePath);
                await vscode.workspace.fs.stat(includeUri); // Check if file exists
                console.log(`Jumping to: ${includePath}`);

                // Create DefinitionLink for "Peek"
                const originRange = new vscode.Range(
                    position.line, filenameStartIndexInLine,
                    position.line, filenameEndIndexInLine
                );

                const targetDoc = await vscode.workspace.openTextDocument(includeUri);
                const targetRange = targetDoc.lineAt(0).range;

                return [{
                    originSelectionRange: originRange,
                    targetUri: includeUri,
                    targetRange: targetRange
                }];

            } catch (e) {
                console.error(`Include file not found: ${includePath}`);
                vscode.window.showErrorMessage(`Include file not found: ${includePath}`);
                return undefined;
            }
        }
    }
    return undefined;
}

/* Handles Go to Definition for $(VariableName). Jumps to *any* tag with <... Name="Var">, *except* for <Expand ...>. */
async function findVariableDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): Promise<vscode.DefinitionLink[] | undefined> {
    
    // Get the variable name from "$(...)""
    const lineText = document.lineAt(position.line).text;
    const linePrefix = lineText.substring(0, position.character);
    const lineSuffix = lineText.substring(position.character);

    const varStartMatch = linePrefix.match(/\$\(([^)]*)$/);
    const varEndMatch = lineSuffix.match(/^([^)]*)\)/);

    if (!varStartMatch || !varEndMatch || varStartMatch.index === undefined) {
        return undefined; // Cursor is not inside a "$(...)" block or match index is missing
    }

    const variableName = varStartMatch[1] + varEndMatch[1];
    if (!variableName) return;

    // Create DefinitionLink for "Peek"
    const originStartPos = new vscode.Position(position.line, varStartMatch.index);
    const originEndPos = new vscode.Position(position.line, linePrefix.length + varEndMatch[0].length);
    const originSelectionRange = new vscode.Range(originStartPos, originEndPos);

    console.log(`Searching for Variable: ${variableName}`);

    // Build the dependency list
    const dependencies = new Set<string>();
    await findFileDependencies(document.uri, dependencies, token);
    if (token.isCancellationRequested) return;

    console.log(`Searching in ${dependencies.size} relevant files...`);

    // Create the GENERAL regex
    const escapedVar = variableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const generalNameRegex = new RegExp(`<(\\w+)[^>]*\\sName="${escapedVar}"`, 'gi');

    // Search only the relevant files
    for (const filePath of dependencies) {
        const fileUri = vscode.Uri.file(filePath);
        const fileDoc = await vscode.workspace.openTextDocument(fileUri);
        const fileText = fileDoc.getText();

        let match;
        while ((match = generalNameRegex.exec(fileText)) !== null) {
            
            const tagName = match[1];

            // expand tags are excluded as they follow different rules..
            if (tagName.toLowerCase() !== 'expand') {
                console.log(`Definition found in: ${fileUri.fsPath} (Tag: <${tagName}>)`);

                // Create DefinitionLink for "Peek"
                const targetPos = fileDoc.positionAt(match.index);
                const targetLine = fileDoc.lineAt(targetPos.line);
                const targetRange = targetLine.range;

                return [{
                    originSelectionRange: originSelectionRange,
                    targetUri: fileUri,
                    targetRange: targetRange
                }];
            }
        }
    }

    console.log(`No definition found for ${variableName} in relevant files.`);
    return undefined;
}


/* Recursively finds all file dependencies (via <Include>) starting from a root file. */
async function findFileDependencies(
    fileUri: vscode.Uri,
    visitedFilePaths: Set<string>,
    token: vscode.CancellationToken
): Promise<void> {

    if (token.isCancellationRequested || visitedFilePaths.has(fileUri.fsPath)) {
        return;
    }
    
    visitedFilePaths.add(fileUri.fsPath);

    let fileContents;
    try {
        const fileData = await vscode.workspace.fs.readFile(fileUri);
        fileContents = fileData.toString();
    } catch (e) {
        console.warn(`Could not read file: ${fileUri.fsPath}`);
        return;
    }

    const includeRegex = /<Include\s+Script="([^"]+)"/gi;
    const currentDir = path.dirname(fileUri.fsPath);
    const promises: Promise<void>[] = [];
    let match;

    while ((match = includeRegex.exec(fileContents)) !== null) {
        const includedFilename = match[1];
        const includedPath = path.resolve(currentDir, includedFilename);
        const includedUri = vscode.Uri.file(includedPath);
        promises.push(findFileDependencies(includedUri, visitedFilePaths, token));
    }

    await Promise.all(promises);
}