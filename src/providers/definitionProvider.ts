import * as vscode from 'vscode';
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

        // Check for $(VariableName)
        definition = await findVariableDefinition(document, position, token);
        if (definition) {
            return definition;
        }

        // Nothing found
        return undefined;
    }
}