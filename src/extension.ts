import * as vscode from 'vscode';
import { BuildGraphDefinitionProvider } from './providers/definitionProvider';
import { BuildGraphHoverProvider } from './providers/hoverProvider';
import { BuildGraphDocumentSymbolProvider } from './providers/symbolProvider';
import { BuildGraphSemanticTokenProvider, legend } from './providers/tokenProvider';

const XML_SELECTOR = { language: 'xml' };

export function activate(context: vscode.ExtensionContext) {
    console.log('BuildGraph VSCode is active!');

    // Register Definition Provider
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            XML_SELECTOR, 
            new BuildGraphDefinitionProvider()
        )
    );

    // Register Hover Provider
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            XML_SELECTOR,
            new BuildGraphHoverProvider()
        )
    );

    // Register Symbol Provider
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            XML_SELECTOR,
            new BuildGraphDocumentSymbolProvider()
        )
    );

    // Register Semantic Token Provider
    context.subscriptions.push(
        vscode.languages.registerDocumentSemanticTokensProvider(
            XML_SELECTOR, 
            new BuildGraphSemanticTokenProvider(), 
            legend
        )
    );
}

export function deactivate() { 
}