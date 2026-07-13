import * as vscode from 'vscode';
import * as path from 'path';

export class BuildGraphDocumentSymbolProvider implements vscode.DocumentSymbolProvider {

    public provideDocumentSymbols(
        document: vscode.TextDocument, 
        token: vscode.CancellationToken
    ): vscode.DocumentSymbol[] {
        
        const symbols: vscode.DocumentSymbol[] = [];
        const text = document.getText();
        
        const rootVariablesSymbol = new vscode.DocumentSymbol(
            "Variables", 
            "Variables Group", 
            vscode.SymbolKind.Array,
            document.lineAt(0).range,
            document.lineAt(0).range
        );
        
        const parentStack: vscode.DocumentSymbol[] = [];
        
        // This regex finds:
        // 1. Opening tags (match[1])
        // 2. Optionally, the content of a Name="...' attribute (match[3])
        // 3. If it's self-closing (match[4])
        // 4. Closing tags (match[5])
        // 5. Start and end of XML comments (match[6])
        const regex = /<(\w+)([^>]*?Name\s*=\s*"([^"]+)")?[^>]*?(\/?)>|<\/(\w+)\s*>|(<!--|-->)/gi;
        let match;
        let withinComment = false;

        while ((match = regex.exec(text))) {
            if (token.isCancellationRequested) {
                return [];
            }

            const openingTagName = match[1];
            const nameValue = match[3];
            const isSelfClosing = match[4] === '/';
            const closingTagName = match[5];
            const isCommentStart = match[6] === '<!--';
            const isCommentEnd = match[6] === '-->';

            if (withinComment) {
                if (isCommentEnd) {
                    withinComment = false;
                }
                continue;
            }
            if (isCommentStart) {
                withinComment = true;
                continue;
            }

            let currentParent = parentStack.length > 0 ? parentStack[parentStack.length - 1] : undefined;

            if (openingTagName) {
                const tagNameLower = openingTagName.toLowerCase();

                if (!this.isOutlineSymbol(tagNameLower)) {
                    continue;
                }

                const tagRange = new vscode.Range(
                    document.positionAt(match.index),
                    document.positionAt(match.index + match[0].length)
                );
                
                // Use the Name="..." value as the display name, or the tag name if no Name
                const displayName = nameValue || openingTagName;
                
                let selectionRange: vscode.Range;

                if (nameValue) {
                    const nameIndexInMatch = match[0].lastIndexOf(nameValue);
                    const nameStartIndex = match.index + nameIndexInMatch;
                    selectionRange = new vscode.Range(
                        document.positionAt(nameStartIndex),
                        document.positionAt(nameStartIndex + nameValue.length)
                    );
                } else {
                    const tagStartIndex = match.index + 1;
                    selectionRange = new vscode.Range(
                        document.positionAt(tagStartIndex),
                        document.positionAt(tagStartIndex + openingTagName.length)
                    );
                }

                const kind = this.getSymbolKind(tagNameLower);
                const symbol = new vscode.DocumentSymbol(
                    displayName, 
                    openingTagName,
                    kind, 
                    tagRange,
                    selectionRange
                );
                
                if (tagNameLower === 'node') {
                    this.addProducesSymbols(match[0], match.index, document, symbol);
                }

                if (tagNameLower === 'property' || tagNameLower === 'envvar' || tagNameLower === 'option') {
                    if (currentParent) {
                        currentParent.children.push(symbol);
                    } else {
                        rootVariablesSymbol.children.push(symbol);
                    }
                } else {
                    if (currentParent) {
                        currentParent.children.push(symbol);
                    } else {
                        symbols.push(symbol);
                    }
                    
                    if (!isSelfClosing) {
                        parentStack.push(symbol);
                    }
                }

            } else if (closingTagName) {
                currentParent = parentStack.length > 0 ? parentStack[parentStack.length - 1] : undefined;
                if (currentParent && currentParent.detail.toLowerCase() === closingTagName.toLowerCase()) {
                    const closingTagEndPosition = document.positionAt(match.index + match[0].length);
                    currentParent.range = new vscode.Range(currentParent.range.start, closingTagEndPosition);
                    
                    parentStack.pop();
                }
            }
        }

        if (rootVariablesSymbol.children.length > 0) {
            const firstChildRange = rootVariablesSymbol.children[0].range;
            const lastChildRange = rootVariablesSymbol.children[rootVariablesSymbol.children.length - 1].range;
            rootVariablesSymbol.range = new vscode.Range(firstChildRange.start, lastChildRange.end);
            rootVariablesSymbol.selectionRange = rootVariablesSymbol.range;
            symbols.push(rootVariablesSymbol);
        }

        const includeRegex = /<Include\s+Script="([^"]+)"/gi;
        let includeMatch;

        while ((includeMatch = includeRegex.exec(text))) {
            if (token.isCancellationRequested) {
                break;
            }
            
            const relativePath = includeMatch[1];
            const tagRange = new vscode.Range(
                document.positionAt(includeMatch.index),
                document.positionAt(includeMatch.index + includeMatch[0].length)
            );

            const pathIndexInMatch = includeMatch[0].indexOf(relativePath);
            const pathStartIndex = includeMatch.index + pathIndexInMatch;
            const selectionRange = new vscode.Range(
                document.positionAt(pathStartIndex),
                document.positionAt(pathStartIndex + relativePath.length)
            );

            const includeSymbol = new vscode.DocumentSymbol(
                path.basename(relativePath), 
                "Include", 
                vscode.SymbolKind.Module,
                tagRange, 
                selectionRange
            );
            
            symbols.push(includeSymbol);
        }

        return symbols.sort((a, b) => a.range.start.compareTo(b.range.start));
    }

    //Finds and adds 'Produces' tags as children to a Node symbol.
    private addProducesSymbols(
        fullTagText: string, 
        tagDocumentIndex: number, 
        document: vscode.TextDocument, 
        nodeSymbol: vscode.DocumentSymbol
    ) {
        const producesRegex = /\sProduces="([^"]+)"/i;
        const producesMatch = producesRegex.exec(fullTagText);

        if (producesMatch) {
            const producesValue = producesMatch[1];
            const producesValueIndex = producesMatch[0].indexOf(producesValue);
            
            const tagRegex = /#[\w\d_]+/g;
            let tagMatch;
            
            while ((tagMatch = tagRegex.exec(producesValue))) {
                const tagName = tagMatch[0];
                
                const tagStartIndex = tagDocumentIndex + 
                                      producesMatch.index + 
                                      producesValueIndex + 
                                      tagMatch.index;
                
                const tagEndIndex = tagStartIndex + tagName.length;

                const tagSelectionRange = new vscode.Range(
                    document.positionAt(tagStartIndex),
                    document.positionAt(tagEndIndex)
                );

                const tagSymbol = new vscode.DocumentSymbol(
                    tagName,
                    "Produces",
                    vscode.SymbolKind.Event,
                    tagSelectionRange,
                    tagSelectionRange
                );
                
                nodeSymbol.children.push(tagSymbol);
            }
        }
    }

    private isOutlineSymbol(tagNameLower: string): boolean {
        switch (tagNameLower) {
            case 'agent':
            case 'node':
            case 'macro':
            case 'property':
            case 'option':
            case 'envvar':
            case 'createartifact':
            case 'aggregate':
            case 'label':
                return true;
            default:
                return false;
        }
    }

    private getSymbolKind(tagName: string): vscode.SymbolKind {
        switch (tagName.toLowerCase()) {
            case 'agent':
                return vscode.SymbolKind.Class;
            case 'node':
                return vscode.SymbolKind.Function;
            case 'macro':
                return vscode.SymbolKind.Function;
            case 'property':
                return vscode.SymbolKind.Property;
            case 'option':
                return vscode.SymbolKind.Variable;
            case 'envvar':
                return vscode.SymbolKind.Constant;
            case 'createartifact':
                return vscode.SymbolKind.Event;
            case 'aggregate':
                return vscode.SymbolKind.Package;
            case 'label':
                return vscode.SymbolKind.String;
            default:
                return vscode.SymbolKind.Object;
        }
    }
}