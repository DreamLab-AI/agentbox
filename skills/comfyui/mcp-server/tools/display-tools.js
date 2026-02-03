/**
 * Display Integration Tools
 * Handles display capture and interaction via VNC
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);

module.exports = function(server, services) {
  const { logger } = services;

  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      // Display Capture
      if (name === 'display_capture') {
        const { region = 'full', format = 'png' } = args;

        logger.info('Capturing display', { region, format });

        const timestamp = Date.now();
        const outputPath = `/tmp/comfyui_capture_${timestamp}.${format}`;

        // Use scrot or import to capture display
        let captureCmd;
        if (region === 'full') {
          captureCmd = `DISPLAY=:1 scrot ${outputPath} 2>/dev/null || DISPLAY=:1 import -window root ${outputPath}`;
        } else {
          // Region format: "x,y,width,height"
          captureCmd = `DISPLAY=:1 import -window root -crop ${region} ${outputPath}`;
        }

        try {
          await execAsync(captureCmd);

          // Check if file exists
          const stats = await fs.stat(outputPath);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                path: outputPath,
                size: stats.size,
                format,
                region,
                message: 'Display captured successfully'
              }, null, 2)
            }]
          };
        } catch (captureError) {
          throw new Error(`Failed to capture display: ${captureError.message}`);
        }
      }

      // Display Interact
      if (name === 'display_interact') {
        const { action, x, y, button = 1, text } = args;

        if (!action) {
          throw new Error('action is required (click, move, type, key)');
        }

        logger.info('Display interaction', { action, x, y });

        let cmd;
        switch (action) {
          case 'click':
            if (x === undefined || y === undefined) {
              throw new Error('x and y coordinates required for click');
            }
            cmd = `DISPLAY=:1 xdotool mousemove ${x} ${y} click ${button}`;
            break;

          case 'move':
            if (x === undefined || y === undefined) {
              throw new Error('x and y coordinates required for move');
            }
            cmd = `DISPLAY=:1 xdotool mousemove ${x} ${y}`;
            break;

          case 'type':
            if (!text) {
              throw new Error('text is required for type action');
            }
            cmd = `DISPLAY=:1 xdotool type --delay 100 "${text.replace(/"/g, '\\"')}"`;
            break;

          case 'key':
            if (!text) {
              throw new Error('key name is required for key action');
            }
            cmd = `DISPLAY=:1 xdotool key ${text}`;
            break;

          default:
            throw new Error(`Unknown action: ${action}`);
        }

        try {
          await execAsync(cmd);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: true,
                action,
                parameters: { x, y, button, text },
                message: `Display interaction '${action}' executed successfully`
              }, null, 2)
            }]
          };
        } catch (interactError) {
          throw new Error(`Failed to interact with display: ${interactError.message}`);
        }
      }

    } catch (error) {
      logger.error('Display tool error', { name, error: error.message });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
            tool: name,
            hint: 'Ensure xdotool and scrot are installed and DISPLAY is available'
          }, null, 2)
        }],
        isError: true
      };
    }
  });
};
