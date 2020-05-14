#!/usr/bin/env node
const fs = require('fs');
const https = require('https');
const { spawnSync } = require('child_process');
const LOGFILE = __dirname + "/log.txt";
const WEBHOOK = "https://discordapp.com/api/webhooks/some/stuffhere";

const rules = [
    {
        regex: new RegExp(/^Ubuntu/i),
        target: "gdrive:Linux/Ubuntu",
        ext: ['iso', 'bin'], //If [], then the whole folder is copied
        unrar: true, //Unrar if rar present?
        single: true, //If set to false, rule will ignore regex matches to a "single file" torrent. If true, rclone will ALWAYS occur on regex match to single file, irrespextive of ext[] values. This is because if single file is desired you might as well specify extensions in the regex
        keep_folder_name: false, //If we get an ext[] inside a folder, do we copy the ext[] directly to target/, or to target/foldername/?
        delete_unrard: true //Delete extracted files after rclone (Will not delete original files)
    },
    {
        regex: new RegExp(/Fedora/i),
        target: "gdrive:Linux/Fedora",
        ext: [], //The whole folder will be copied
        unrar: true, //Nothing will be unrard since the whole folder is a match already
        single: true //Since it might be just an .iso file, we need this ot be true. Else it will get skipped
    }
]

const log = (msg) => {
    msg = msg + '\n';
    fs.appendFileSync(LOGFILE, msg);
}

const discord_message = (msg) => {

    return new Promise((resolve, reject) => {

        //HTTPS setup
        const data = JSON.stringify({
            username: "PPBot",
            content: msg
        });

        const options = {
            hostname: "discordapp.com",
            port: 443,
            path: WEBHOOK.substr(22),
            method: 'POST',
            headers: {
                "Content-Type": "application/json"
            }
        };

        const req = https.request(options, res => {
            resolve(true);
        });

        req.on("error", err => {
            reject(false);
            log(`Webhook failed for msg ${msg}`)
        })

        req.write(data);
        req.end();
    })
}

(async () => {

    let start, end, time;

    if (process.argv.length == 5) {
        //For deluge execute

        //We check if this matches our regexes
        const rule = rules.find(el => {
            return el.regex.test(process.argv[3]);
        });

        if (!rule) {
            process.exit(0); //Nothing to do here
        }

        //We have a rule. Let's build the path
        await discord_message("**[RULE MATCH]** " + process.argv[3]);
        const fname = process.argv[3]; //folder/file name
        const path = process.argv[4] + '/' + process.argv[3]; // /homexx/username/Downloads/Movie.2010.1080p
        let rclone_command = `rclone copy `;

        //Let's check if it is a single file. If so, we directly rclone it
        if (fs.lstatSync(path).isFile()) {
            if (rule.single) {

                rclone_command += `"${fname}" "${rule.target}" -P`;
                await discord_message(`**[RCLONE]** Matched single file. Starting transfer...`);
                start = Date.now();
                const rclone_result = spawnSync(rclone_command, { shell: true, cwd: process.argv[4] }); //cwd is the downloads directory
                end = Date.now();
                time = ((end - start) / 1000).toString();

                if (rclone_result.status != 0) {
                    await discord_message(`**[RCLONE]** failed to copy ${fname}`);
                    process.exit(1);
                } else {
                    await discord_message(`**[RCLONE]** successfully copied ${fname} in ${time} seconds.`);
                    process.exit(0);
                }
            }

            await discord_message(`[PPBOT] Did not copy as single file rule was set to false.`);
            process.exit(0);
        }

        //check if we want specific extensions. Else we can rclone the whole thing
        if (!rule.ext || rule.ext.length == 0) {

            rclone_command += `"${fname}" "${rule.target}${fname}" -P`;
            await discord_message(`**[RCLONE]** Matched whole folder. Starting transfer...`);
            start = Date.now();
            const rclone_result = spawnSync(rclone_command, { shell: true, cwd: process.argv[4] });
            end = Date.now();
            time = ((end - start) / 1000).toString();

            if (rclone_result.status != 0) {
                await discord_message(`**[RCLONE]** failed to copy ${fname}`);
                process.exit(1);
            } else {
                await discord_message(`**[RCLONE]** successfully copied ${fname} in ${time} seconds.`);
                process.exit(0);
            }

        }

        const files_og = fs.readdirSync(path);
        let i;
        let unrard = false;

        if (rule.unrar) {
            for (i = 0; i < files_og.length; i++) {
                if (files_og[i].endsWith("rar")) {
                    break; //Only single unrar right?
                }
            }

            if (i < files_og.length) {
                //We found a rar. We need to unrar it
                unrard = true;
                const unrar_command = `unrar x ${files_og[i]}`
                // log("[UNRAR] " + unrar_command);
                await discord_message(`**[UNRAR]** Found a RAR ${files_og[i]}. Extracting...`);

                //Execute unrar - syncronous?
                start = Date.now();
                const unrar_result = spawnSync(unrar_command, { shell: true, cwd: path });
                end = Date.now();
                time = ((end - start) / 1000).toString();

                if (unrar_result.status != 0) {
                    await discord_message(`**[UNRAR]** Extraction failed.`);
                    process.exit(1);
                }

                log("[UNRAR] Complete!");
                await discord_message(`**[UNRAR]** Extraction completed in ${time} seconds.`)
            }
        }

        const files = fs.readdirSync(path); //Get updated file list after the unrar

        //Now we loop over files again, those that match extension can get rclones
        for (i = 0; i < files.length; i++) {

            if (rule.ext.some(ext => {
                return files[i].endsWith(ext); //If this file matches some extension
            })) {

                rclone_command = `rclone copy `; //Re set because multiple times
                rclone_command += `"${files[i]}" "${rule.target}`;

                if (rule.keep_folder_name) {
                    rclone_command += `${fname}/" -P` //Target already ends with a '/'
                } else {
                    rclone_command += `" -P`;
                }

                log("**[EXT MATCH]** " + rclone_command);
                await discord_message(`**[RCLONE]** Matched extension for ${files[i]} Starting transfer...`);
                start = Date.now();
                const rclone_result = spawnSync(rclone_command, { shell: true, cwd: path });
                end = Date.now();
                time = ((end - start) / 1000).toString();

                if (rclone_result.status != 0) {
                    await discord_message(`**[RCLONE]** failed to copy ${files[i]}`);
                } else {
                    await discord_message(`**[RCLONE]** successfully copied ${files[i]} in ${time} seconds.`);
                }
            }

            //Now that we've "processed", check if it is in files_og. If it is, do nothing. Else delete (unRARd)
            if (unrard && rule.delete_unrard) {

                if (!files_og.some(filename => {
                    return filename == files[i]; //If the filename exists, then we don't need to delete it
                })) {
                    // It did not. Let's delete it.
                    fs.unlinkSync(path + '/' + files[i]);
                    await discord_message(`**[DELETE]** Deleted unrard file ${files[i]}!`);
                }
            }
        }
    }
})();