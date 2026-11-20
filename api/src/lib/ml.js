import axios from 'axios';
import FormData from 'form-data';

const mlclient = axios.create({
    baseURL: process.env.ML_SERVICE_URL,
    timeout: 30000,
});

export async function processPhoto(photoID, threadID, imageUrl){
    const { data } = await mlclient.post('/process-photo', {
        photo_id: photoID,
        thread_id: threadID,
        image_url: imageUrl,
    });
    return data; 
}

export async function indexUser(userId, buffers, mimetypes){
    const form = new FormData();
    form.append('user_id', userId);

    buffers.forEach((buf, i) => {
        form.append('selfies', buf, {
            filename: `selfie_${i}.jpg`,
            contentType: mimetypes[i] ?? 'image/jpeg',
        });
    });

    const { data } = await mlclient.post('/index-user', form, {
        headers: form.getHeaders(), 
    });
    return data; 
}

export async function search(userId, threadId, threshold = 0.6) {
    const { data } = await mlclient.post('/search', {
        user_id: userId,
        thread_id: threadId,
        threshold,
    });

    return data; 
}
