import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

async function testAnalyze() {
    const url = 'http://127.0.0.1:4000/api/analyze';
    const imagePath = '../client/src/resources/circle-93mm.jpg';

    for (let i = 1; i <= 2; i++) {
        console.log(`Test ${i}: Sending request...`);
        const form = new FormData();
        form.append('image', fs.createReadStream(imagePath));
        form.append('threshold', '58.8');

        try {
            const response = await axios.post(url, form, {
                headers: form.getHeaders(),
            });
            console.log(`Test ${i}: Success! Status: ${response.status}`);
        } catch (error) {
            console.error(`Test ${i}: Failed!`);
            if (error.code) {
                console.error(`Error code: ${error.code}`);
            } else if (error.response) {
                console.error(`Status: ${error.response.status}`);
                console.error(`Data:`, error.response.data);
            } else {
                console.error(`Message: ${error.message}`);
            }
        }
    }
}

testAnalyze();
