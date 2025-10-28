import * as vscode from 'vscode';
import * as path from 'path';

export class BuildGraphCommandProvider {
    private terminal: vscode.Terminal | undefined;

    public async runTarget(editor: vscode.TextEditor) {
        const command = await this.buildUatCommand(editor, false);
        if (command) {
            this.runInTerminal(`& ${command}`);
        }
    }

    public async runTargetListOnly(editor: vscode.TextEditor) {
        const command = await this.buildUatCommand(editor, true);
        if (command) {
            this.runInTerminal(`& ${command}`);
        }
    }

    public async copyUatCommandline(editor: vscode.TextEditor) {
        const command = await this.buildUatCommand(editor, false); 
        if (command) {
            vscode.env.clipboard.writeText(command);
            vscode.window.showInformationMessage("BuildGraph command copied to clipboard.");
        }
    }
    
    private runInTerminal(command: string) {
        if (!this.terminal || this.terminal.exitStatus) {
            this.terminal = vscode.window.createTerminal("BuildGraph UAT");
        }
        this.terminal.show(false);
        this.terminal.sendText(command, true);
    }

    private async buildUatCommand(
        editor: vscode.TextEditor, 
        listOnly: boolean
    ): Promise<string | undefined> {
        
        const document = editor.document;
        const position = editor.selection.active;

        const targetName = this.getTargetNameAtLine(document.lineAt(position.line));
        if (!targetName) {
            vscode.window.showWarningMessage("No <Node> or <Aggregate> 'Name' attribute found on this line.");
            return undefined;
        }

        const scriptDir = path.dirname(document.uri.fsPath);
        const uatPath = await this.findRunUat(scriptDir);
        if (!uatPath) {
            vscode.window.showErrorMessage("Could not find RunUAT.bat in any parent directory.");
            return undefined;
        }

        const scriptPath = document.uri.fsPath;
        const uatDir = path.dirname(uatPath);

        const relativeScriptPath = path.relative(uatDir, scriptPath);
        const listOnlyFlag = listOnly ? " -ListOnly" : "";
        const baseCommand = `BuildGraph -Script="${relativeScriptPath}" -Target="${targetName}"${listOnlyFlag}`;
        
        return `"${uatPath}" ${baseCommand}`;
    }

    private getTargetNameAtLine(line: vscode.TextLine): string | undefined {
        const regex = /<(Node|Aggregate)\s+[^>]*Name="([^"]+)"/i;
        const match = line.text.match(regex);
        
        if (match && match[2]) {
            return match[2];
        }
        return undefined;
    }

    // Recursively searches upwards from startDir to find RunUAT.bat.
    private async findRunUat(startDir: string): Promise<string | undefined> {
        let currentDir = startDir;

        while (true) {
            const uatPath = path.join(currentDir, 'RunUAT.bat');
            const uatUri = vscode.Uri.file(uatPath);

            try {
                await vscode.workspace.fs.stat(uatUri);
                return uatPath;
            } catch (e) {
                const parentDir = path.dirname(currentDir);

                if (parentDir === currentDir) {
                    return undefined;
                }
                currentDir = parentDir;
            }
        }
    }
}