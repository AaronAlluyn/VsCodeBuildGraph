import * as vscode from 'vscode';
import * as path from 'path';
import { findExpandDefinition, findIncludeDefinition, findVariableDefinition } from '../utils/textDocumentUtils';

export class BuildGraphHoverProvider implements vscode.HoverProvider {

    public async provideHover(
        document: vscode.TextDocument, 
        position: vscode.Position, 
        token: vscode.CancellationToken
    ): Promise<vscode.Hover | undefined> {
        
        // Check if we're hovering a $(variable)
        let definitionLinks = await findVariableDefinition(document, position, token);
        if (definitionLinks) {
            return this.buildHover(definitionLinks[0]);
        }

        // Check if we're hovering an <Expand Name="...">
        definitionLinks = await findExpandDefinition(document, position, token);
        if (definitionLinks) {
            return this.buildHover(definitionLinks[0]);
        }

        // Check if we're hovering an <Include Script="...">
        definitionLinks = await findIncludeDefinition(document, position);
        if (definitionLinks) {
            const filename = path.basename(definitionLinks[0].targetUri.fsPath);
            const hoverText = new vscode.MarkdownString();
            hoverText.appendMarkdown(`*(include)*`);
            hoverText.appendCodeblock(filename, 'xml');
            return new vscode.Hover(hoverText, definitionLinks[0].originSelectionRange);
        }

        return undefined;
    }

    // Takes a DefinitionLink and builds a Hover tooltip.
    private async buildHover(link: vscode.DefinitionLink): Promise<vscode.Hover> {
        const targetDoc = await vscode.workspace.openTextDocument(link.targetUri);
        const targetLine = targetDoc.lineAt(link.targetRange.start.line);
    
        const hoverText = new vscode.MarkdownString();
        hoverText.appendCodeblock(targetLine.text.trim(), 'xml');
    
        return new vscode.Hover(hoverText, link.originSelectionRange);
    }
}