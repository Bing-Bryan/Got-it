// @vitest-environment node
import{it,expect}from'vitest';
import{articleUrl,mediaUrl,sourceImageUrl}from'./web-sites';
it('accepts arbitrary public HTTPS article paths and cross-domain media without hard domain lists',()=>{
 for(const u of ['https://new-public.example/any/article?language=en','https://www.lennysnewsletter.com/p/how-to-turn-your-ai-into-a-world','https://openai.com/index/an-alien-mind/','https://cdn.new-public.example/assets/image?id=1']){expect(articleUrl(u).href).toBe(u);expect(mediaUrl(u).href).toBe(u);}
 for(const u of ['http://public.example/article','https://u:p@public.example/','https://127.0.0.1/a','https://[::1]/','https://localhost/a','https://example.com:444/a','https://example.com/?access_token=CONTROLLED_SECRET'])expect(()=>articleUrl(u)).toThrow();
});
it('validates image proxy targets equally and rejects private or duplicate targets',()=>{
 const good='https://new-cdn.example/resource';
 expect(sourceImageUrl('/_next/image?url='+encodeURIComponent(good)+'&w=3840&q=75',new URL('https://www.anthropic.com/research/test')).href).toBe(good);
 for(const raw of ['/_next/image?url=http%3A%2F%2F127.0.0.1%2Fa.png','/_next/image?url='+encodeURIComponent(good)+'&url='+encodeURIComponent(good)])expect(()=>sourceImageUrl(raw,new URL('https://www.anthropic.com/research/test'))).toThrow();
});
