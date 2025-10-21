import * as vscode from 'vscode';

export class BuildGraphDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    public provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentSymbol[] {
        
        const symbols: vscode.DocumentSymbol[] = [];
        const text = document.getText();
        const regex = /<(\w+)[^>]*\sName="([^"]+)"/gi;
        let match;

        while ((match = regex.exec(text))) {
            const tagName = match[1];
            const elementName = match[2];
            const tagRangeStartPos = document.positionAt(match.index);
            const fullLineRange = document.lineAt(tagRangeStartPos.line).range;
            const nameIndexInMatch = match[0].lastIndexOf(elementName);
            const nameStartIndex = match.index + nameIndexInMatch;
            const selectionRange = new vscode.Range(
                document.positionAt(nameStartIndex),
                document.positionAt(nameStartIndex + elementName.length)
            );

            symbols.push(new vscode.DocumentSymbol(
                elementName, 
                tagName, 
                this.getSymbolKind(tagName), 
                fullLineRange, 
                selectionRange
            ));
        }
        return symbols;
    }

    private getSymbolKind(tagName: string): vscode.SymbolKind {
        switch (tagName.toLowerCase()) {
            case 'agent':
                return vscode.SymbolKind.Module;
            case 'node':
                return vscode.SymbolKind.Class;
            case 'macro':
                return vscode.SymbolKind.Function;
            case 'property':
                return vscode.SymbolKind.Property;
            case 'option':
                return vscode.SymbolKind.EnumMember;
            case 'envvar':
                return vscode.SymbolKind.Variable;
            default:
                return vscode.SymbolKind.Object;
        }
    }
}