import * as vscode from 'vscode';
import * as path from 'path'; 
import { findExpandDefinition, findIncludeDefinition, findVariableDefinition } from '../utils/textDocumentUtils';

export class BuildGraphDefinitionProvider implements vscode.DefinitionProvider {

    // The main "router" for Go to Definition.
    public async provideDefinition(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
    ): Promise<vscode.DefinitionLink[] | undefined> {
        
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

        // Check for #TagName
        definition = await this.findTagDefinition(document, position, token);
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

    private getTagAtPosition(document: vscode.TextDocument, position: vscode.Position): { range: vscode.Range, tagName: string } | undefined {
        const line = document.lineAt(position.line);
        const lineText = line.text;
        
        const tagRegex = /#[\w\d_]+/g;
        let match;
        while ((match = tagRegex.exec(lineText))) {
            const startPos = match.index;
            const endPos = startPos + match[0].length;

            if (position.character >= startPos && position.character <= endPos) {
                const range = new vscode.Range(
                    new vscode.Position(position.line, startPos),
                    new vscode.Position(position.line, endPos)
                );
                return { range: range, tagName: match[0] };
            }
        }
        return undefined;
    }

    private async openIncludedDocument(uri: vscode.Uri): Promise<vscode.TextDocument | null> {
        try {
            return await vscode.workspace.openTextDocument(uri);
        } catch (e) {
            return null; 
        }
    }

    private async findTagDefinition(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
    ): Promise<vscode.DefinitionLink[] | undefined> {
        
        const tagInfo = this.getTagAtPosition(document, position);
        if (!tagInfo) {
            return undefined;
        }

        const tagName = tagInfo.tagName; 
        const originRange = tagInfo.range;
        
        const definitionRegex = /<Node\s+[^>]*\sProduces="([^"]+)"/gi;

        const docsToSearch: { doc: vscode.TextDocument, text: string }[] = [];
        const currentText = document.getText();
        docsToSearch.push({ doc: document, text: currentText });

        const includeRegex = /<Include\s+Script="([^"]+)"/gi;
        const currentDir = path.dirname(document.uri.fsPath);
        const includePromises: Promise<vscode.TextDocument | null>[] = [];
        let includeMatch;

        while ((includeMatch = includeRegex.exec(currentText))) {
            const relativePath = includeMatch[1];
            const absolutePath = path.resolve(currentDir, relativePath);
            const includeUri = vscode.Uri.file(absolutePath);
            
            includePromises.push(this.openIncludedDocument(includeUri));
        }

        const loadedIncludes = await Promise.all(includePromises);
        for (const includeDoc of loadedIncludes) {
            if (includeDoc) {
                docsToSearch.push({ doc: includeDoc, text: includeDoc.getText() });
            }
        }

        for (const docInfo of docsToSearch) {
            if (token.isCancellationRequested) {
                return undefined;
            }

            definitionRegex.lastIndex = 0; 
            let match;

            while ((match = definitionRegex.exec(docInfo.text))) {
                const producesValue = match[1]; 
                
                const tagIndexInValue = producesValue.indexOf(tagName);
                if (tagIndexInValue === -1) {
                    continue; 
                }

                const valueStartIndexInMatch = match[0].indexOf(producesValue);
                const tagStartIndex = match.index + valueStartIndexInMatch + tagIndexInValue;
                const tagEndIndex = tagStartIndex + tagName.length;

                const targetRange = new vscode.Range(
                    docInfo.doc.positionAt(tagStartIndex),
                    docInfo.doc.positionAt(tagEndIndex)
                );

                const targetSelectionRange = new vscode.Range(
                    docInfo.doc.positionAt(tagStartIndex + 1), 
                    docInfo.doc.positionAt(tagEndIndex)
                );
                
                return [{
                    originSelectionRange: originRange,
                    targetUri: docInfo.doc.uri,
                    targetRange: targetRange,
                    targetSelectionRange: targetSelectionRange
                }];
            }
        }
        
        return undefined; 
    }
}