import * as vscode from 'vscode';

// --- 1. Define our CUSTOM token types and modifiers ---
const tokenTypes = ['buildGraphTag', 'buildGraphVariable'];
const tokenModifiers = ['declaration'];

export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

// --- 2. The Provider ---

export class BuildGraphSemanticTokenProvider implements vscode.DocumentSemanticTokensProvider {

    public provideDocumentSemanticTokens(
        document: vscode.TextDocument, 
        token: vscode.CancellationToken
    ): vscode.SemanticTokens {
        
        const builder = new vscode.SemanticTokensBuilder(legend);
        const text = document.getText();

        if (token.isCancellationRequested) {
            return builder.build();
        }

        // --- Find all $(Variables) ---
        const varRegex = /\$\(([\w\d_]+)\)/g;
        let varMatch;
        while ((varMatch = varRegex.exec(text))) {
            const startPos = document.positionAt(varMatch.index);
            const fullRange = new vscode.Range(
                startPos, 
                document.positionAt(varMatch.index + varMatch[0].length)
            );
            builder.push(fullRange, 'buildGraphVariable', []);
        }

        // --- Find all #Tags ---
        const tagRegex = /#([\w\d_]+)/g;
        let tagMatch;
        while ((tagMatch = tagRegex.exec(text))) {
            // --- This was the bug fix ---
            const startPos = document.positionAt(tagMatch.index);
            const fullRange = new vscode.Range(
                startPos, 
                document.positionAt(tagMatch.index + tagMatch[0].length)
            );
            // --- End bug fix ---
            builder.push(fullRange, 'buildGraphTag', []);
        }
        
        // --- Find all Tag Declarations (Produces="#...") ---
        const producesRegex = /Produces="([^"]+)"/g;
        let producesMatch;
        while ((producesMatch = producesRegex.exec(text))) {
            const producesValue = producesMatch[1];
            const valueOffset = producesMatch.index + producesMatch[0].indexOf(producesValue);

            const tagInValueRegex = /#([\w\d_]+)/g;
            let tagInValueMatch;
            while ((tagInValueMatch = tagInValueRegex.exec(producesValue))) {
                const tag = tagInValueMatch[0];
                const tagIndex = valueOffset + tagInValueMatch.index;
                const startPos = document.positionAt(tagIndex);
                
                const range = new vscode.Range(
                    startPos,
                    document.positionAt(tagIndex + tag.length)
                );
                
                builder.push(range, 'buildGraphTag', ['declaration']);
            }
        }

        return builder.build();
    }

    public getLegend(): vscode.SemanticTokensLegend {
        return legend;
    }
}